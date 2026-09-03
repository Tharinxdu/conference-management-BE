// src/services/payment-service.js
const mongoose = require("mongoose");
const crypto = require("crypto");
const Payment = require("../models/Payment.js");
const Registration = require("../models/Registration.js");
const { HttpError } = require("../utils/http-error.js");
const { createCheckoutLink, getTransactionStatus } = require("../utils/onepay-client.js");
const { convertUsdToLkr } = require("./exchange-rate-service.js");

const {
  finalizeRegistrationAfterPayment,
} = require("./registration-confirmation-service.js");

/**
 * CURRENCY
 *
 * Fees are denominated in USD. The charged currency is decided entirely by the
 * registration's income group — the client does not choose it and does not send
 * it:
 *
 *   incomeGroup === "LOCAL"  (Sri Lanka)  -> charged in LKR
 *   anything else                          -> charged in USD
 *
 * LKR amounts are converted from the USD fee at the live rate from
 * open.er-api.com. The rate is fetched ONCE, at initiation, and stored on the
 * Payment document with the USD base amount. Verification then compares
 * OnePay's reported amount against payment.amount, which is already in the
 * charged currency — so a rate move between checkout and callback can't trip
 * the mismatch guard.
 *
 * REQUIRED WORKFLOW (unchanged)
 *
 * Status page:
 * 1) If payment already PAID ⇒ return
 * 2) If callback was PAID but DB not yet PAID ⇒ mark PAID immediately (final)
 * 3) Else (callback != PAID) ⇒ verify with status API up to 20 sec
 *    - If status API returns PAID ⇒ mark PAID (truth wins)
 *    - If status API returns FAILED ⇒ mark FAILED
 *    - If not PAID after 20 sec (or status API errors repeatedly) ⇒ mark FAILED (final)
 *
 * Callback:
 * - Always store callback.
 * - If callback status == 1 ⇒ mark PAID immediately (final)
 * - Else do NOT mark FAILED here.
 */

// determineIncomeGroup() maps country "Sri Lanka" to this at creation time.
const LKR_INCOME_GROUP = "LOCAL";

/**
 * The single source of truth for which currency a registration is charged in.
 */
function currencyForRegistration(reg) {
  return reg?.incomeGroup === LKR_INCOME_GROUP ? "LKR" : "USD";
}

function safeAlnumDash(input) {
  return String(input || "").replace(/[^A-Za-z0-9\-]/g, "");
}

/**
 * OnePay reference constraint: <= 21 chars.
 */
function makeReference(reg) {
  const suffix = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  const base = safeAlnumDash(reg.registrationId);
  const maxBaseLen = 21 - (1 + suffix.length);
  const trimmedBase = base.slice(0, Math.max(0, maxBaseLen)) || "REG";
  return `${trimmedBase}-${suffix}`;
}

function toMinorUnits(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function callbackIsPaidFromBody(body) {
  return body?.status !== undefined && Number(body.status) === 1;
}

function callbackIsPaidFromPayment(payment) {
  return payment?.lastCallback?.status !== undefined && Number(payment.lastCallback.status) === 1;
}

function normalizeStatusFromOnepay(data) {
  const s = data?.status;
  const msg = String(data?.status_message || data?.message || "").toUpperCase();

  const isPaid =
    s === true ||
    s === 1 ||
    s === "1" ||
    msg.includes("SUCCESS") ||
    msg.includes("PAID");

  const isFailed =
    s === false ||
    s === 0 ||
    s === "0" ||
    msg.includes("FAILED") ||
    msg.includes("CANCEL") ||
    msg.includes("DECLIN");

  if (isPaid) return "PAID";
  if (isFailed) return "FAILED";
  return "PENDING";
}

async function markFailedFinal({ payment, registrationMongoId, reason }) {
  payment.status = "FAILED";
  payment.lastError = reason || payment.lastError || "Payment not completed.";
  await payment.save().catch(() => {});

  await Registration.findByIdAndUpdate(
    registrationMongoId,
    {
      paymentStatus: "FAILED",
      paymentProvider: "ONEPAY",
      paymentReference: payment.onepayTransactionId || null,
    },
    { new: false }
  ).catch(() => {});
}

async function markPaidFinal({ payment, registrationMongoId, paidAt }) {
  payment.status = "PAID";
  payment.paidAt = payment.paidAt || paidAt || new Date();
  payment.lastError = null;
  await payment.save();

  const reg = await Registration.findById(registrationMongoId);
  if (!reg) throw new HttpError(404, "Registration not found for payment.");

  reg.paymentStatus = "PAID";
  reg.paymentProvider = "ONEPAY";
  reg.paymentCurrency = payment.currency;
  reg.paymentReference = payment.onepayTransactionId || reg.paymentReference || null;
  await reg.save();

  try {
    await finalizeRegistrationAfterPayment({
      registrationMongoId: reg._id,
      paymentReference: payment.onepayTransactionId,
      paymentProvider: "ONEPAY",
    });
  } catch (e) {
    console.error("finalizeRegistrationAfterPayment failed:", e);
    payment.lastError = `Finalize failed: ${e?.message || "unknown"}`;
    await payment.save().catch(() => {});
  }
}

/**
 * Initiate payment (idempotent-ish)
 *
 * Currency is derived from the registration, never supplied by the caller.
 */
async function initiateOnepayPayment(registrationMongoId) {
  if (!mongoose.Types.ObjectId.isValid(registrationMongoId)) {
    throw new HttpError(400, "Invalid registration id.");
  }

  const reg = await Registration.findById(registrationMongoId);
  if (!reg) throw new HttpError(404, "Registration not found.");
  if (reg.paymentStatus === "PAID") throw new HttpError(409, "Registration is already paid.");

  const cur = currencyForRegistration(reg);

  // If an admin edits the country, incomeGroup is recalculated and the currency
  // can flip. Retire any live checkout in the old currency so the registrant
  // can't have two payable links open.
  await Payment.updateMany(
    {
      registrationId: reg._id,
      provider: "ONEPAY",
      currency: { $ne: cur },
      status: { $in: ["INITIATED", "PENDING"] },
    },
    {
      $set: {
        status: "CANCELED",
        canceledAt: new Date(),
        lastError: "Superseded by a payment in a different currency.",
      },
    }
  );

  let payment = await Payment.findOne({
    registrationId: reg._id,
    provider: "ONEPAY",
    currency: cur,
    status: { $in: ["INITIATED", "PENDING"] },
  }).sort({ createdAt: -1 });

  if (payment && payment.status === "PENDING" && payment.redirectUrl) {
    return {
      paymentId: payment._id,
      redirectUrl: payment.redirectUrl,
      onepayTransactionId: payment.onepayTransactionId,
      currency: payment.currency,
      amount: payment.amount,
      reused: true,
    };
  }

  // Price and lock the rate before touching the payment row, so an FX outage
  // doesn't leave an orphaned INITIATED record.
  let amount = reg.feeAmount;
  let fx = null;

  if (cur === "LKR") {
    fx = await convertUsdToLkr(reg.feeAmount);
    amount = fx.amount;
  }

  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw new HttpError(400, "Registration has no valid fee amount.");
  }

  if (!payment) {
    payment = await Payment.create({
      provider: "ONEPAY",
      registrationId: reg._id,
      reference: makeReference(reg),
      currency: cur,
      amount,
      baseAmount: reg.feeAmount,
      exchangeRate: fx?.rate ?? null,
      exchangeRateFetchedAt: fx?.fetchedAt ?? null,
      status: "INITIATED",
      attempts: 0,
    });
  } else {
    // Retrying an INITIATED row — refresh the price and the locked rate.
    payment.currency = cur;
    payment.amount = amount;
    payment.baseAmount = reg.feeAmount;
    payment.exchangeRate = fx?.rate ?? null;
    payment.exchangeRateFetchedAt = fx?.fetchedAt ?? null;
  }

  try {
    payment.attempts += 1;
    payment.lastError = null;
    await payment.save();

    const baseRedirect = process.env.ONEPAY_TRANSACTION_REDIRECT_URL;
    const transactionRedirectUrl = `${baseRedirect}?rid=${encodeURIComponent(String(reg._id))}`;

    const { onepayTransactionId, redirectUrl } = await createCheckoutLink({
      amount: payment.amount,
      currency: payment.currency,
      reference: payment.reference,
      customer: {
        firstName: reg.firstName || "N/A",
        lastName: reg.lastName || "N/A",
        phone: reg.mobile || "N/A",
        email: reg.email,
      },
      transactionRedirectUrl,
      additionalData: reg.registrationId,
    });

    payment.onepayTransactionId = onepayTransactionId;
    payment.redirectUrl = redirectUrl;
    payment.status = "PENDING";
    await payment.save();

    reg.paymentStatus = "PENDING";
    reg.paymentProvider = "ONEPAY";
    reg.paymentCurrency = payment.currency;
    reg.paymentReference = onepayTransactionId;
    await reg.save();

    return {
      paymentId: payment._id,
      redirectUrl,
      onepayTransactionId,
      currency: payment.currency,
      amount: payment.amount,
      reused: false,
    };
  } catch (err) {
    payment.status = "FAILED";
    payment.lastError = err?.message || "Initiation failed";
    await payment.save().catch(() => {});
    throw err instanceof HttpError ? err : new HttpError(500, "Failed to initiate payment.");
  }
}

/**
 * OnePay status API single check:
 * returns finalStatus: "PAID" | "FAILED" | "PENDING" and data payload.
 *
 * payment.amount / payment.currency hold the charged values (LKR for local
 * registrants), so these comparisons are like-for-like.
 */
async function checkStatusApiOnce(payment) {
  const statusRes = await getTransactionStatus(payment.onepayTransactionId);
  const data = statusRes?.data || {};
  const finalStatus = normalizeStatusFromOnepay(data);

  // If PAID, validate amount/currency before confirming
  if (finalStatus === "PAID") {
    const receivedAmountMinor = toMinorUnits(data.amount);
    const expectedAmountMinor = toMinorUnits(payment.amount);
    const currency = data.currency;

    if (
      receivedAmountMinor !== null &&
      expectedAmountMinor !== null &&
      receivedAmountMinor !== expectedAmountMinor
    ) {
      throw new HttpError(409, "Payment amount mismatch. Manual review required.");
    }

    if (currency && String(currency).toUpperCase() !== payment.currency) {
      throw new HttpError(409, "Payment currency mismatch. Manual review required.");
    }
  }

  return { finalStatus, data };
}

/**
 * Callback handler:
 * - store callback
 * - if callback PAID => mark PAID immediately (final)
 * - else keep pending
 */
async function handleOnepayCallback(body) {
  const txId = body?.transaction_id;
  if (!txId) throw new HttpError(400, "Missing transaction_id.");

  const payment = await Payment.findOne({ onepayTransactionId: txId });
  if (!payment) throw new HttpError(404, "Payment not found for transaction_id.");

  payment.lastCallback = {
    transaction_id: body.transaction_id,
    status: body.status,
    status_message: body.status_message,
    additional_data: body.additional_data,
  };
  await payment.save();

  // If callback says PAID -> finalize PAID immediately
  if (callbackIsPaidFromBody(body)) {
    // Gateway retries are normal; without this a retry re-runs finalization
    // and sends the registrant a second QR email.
    if (payment.status === "PAID") {
      return { ok: true, status: "PAID", source: "callback", duplicate: true };
    }

    await markPaidFinal({
      payment,
      registrationMongoId: payment.registrationId,
      paidAt: new Date(),
    });
    return { ok: true, status: "PAID", source: "callback" };
  }

  // callback not paid -> keep pending (don't mark failed here)
  payment.status = "PENDING";
  payment.lastError = body.status_message || payment.lastError || null;
  await payment.save().catch(() => {});

  return { ok: true, status: "PENDING", source: "callback" };
}

/**
 * Status endpoint logic (unchanged)
 */
async function getPaymentStatusForRegistration(registrationMongoId) {
  if (!mongoose.Types.ObjectId.isValid(registrationMongoId)) {
    throw new HttpError(400, "Invalid registration id.");
  }

  const payment = await Payment.findOne({
    registrationId: registrationMongoId,
    provider: "ONEPAY",
  }).sort({ createdAt: -1 });

  if (!payment) throw new HttpError(404, "No payment found for this registration.");

  // 1) If payment already PAID ⇒ return
  if (payment.status === "PAID") return payment;

  // 2) If callback was PAID but DB not yet PAID ⇒ mark PAID immediately (final)
  if (callbackIsPaidFromPayment(payment)) {
    await markPaidFinal({
      payment,
      registrationMongoId,
      paidAt: new Date(),
    });
    return await Payment.findById(payment._id);
  }

  // Can't check status API without transaction id
  if (!payment.onepayTransactionId) {
    await markFailedFinal({
      payment,
      registrationMongoId,
      reason: "Missing OnePay transaction id.",
    });
    return await Payment.findById(payment._id);
  }

  // 3) Else (callback != PAID) ⇒ verify with status API up to 20 sec
  const maxMs = 20 * 1000;
  const intervalMs = 4000; // ~5 checks
  const checks = Math.max(1, Math.ceil(maxMs / intervalMs));

  let lastErr = null;

  for (let i = 0; i < checks; i++) {
    try {
      const { finalStatus, data } = await checkStatusApiOnce(payment);

      // 4) If status API returns PAID ⇒ mark PAID (truth wins)
      if (finalStatus === "PAID") {
        await markPaidFinal({
          payment,
          registrationMongoId,
          paidAt: data.paid_on ? new Date(data.paid_on) : new Date(),
        });
        return await Payment.findById(payment._id);
      }

      // 5) If status API returns FAILED ⇒ mark FAILED
      if (finalStatus === "FAILED") {
        await markFailedFinal({
          payment,
          registrationMongoId,
          reason:
            data.status_message ||
            data.message ||
            "Payment failed, We’re sorry, but your payment could not be completed. Please try again or contact support.",
        });
        return await Payment.findById(payment._id);
      }

      // else PENDING -> keep looping
    } catch (e) {
      lastErr = e?.message || String(e);
      payment.lastError = lastErr;
      await payment.save().catch(() => {});
    }

    if (i < checks - 1) await sleep(intervalMs);
  }

  // 6) If not PAID after 20 sec (or status API errors repeatedly) ⇒ mark FAILED (final)
  await markFailedFinal({
    payment,
    registrationMongoId,
    reason: lastErr || "Payment not confirmed within 20 seconds.",
  });

  return await Payment.findById(payment._id);
}

module.exports = {
  initiateOnepayPayment,
  handleOnepayCallback,
  getPaymentStatusForRegistration,
};