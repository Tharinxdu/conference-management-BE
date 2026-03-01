// src/services/payment-service.js
const mongoose = require("mongoose");
const crypto = require("crypto");
const Payment = require("../models/Payment.js");
const Registration = require("../models/Registration.js");
const { HttpError } = require("../utils/http-error.js");
const { createCheckoutLink, getTransactionStatus } = require("../utils/onepay-client.js");

const {
  finalizeRegistrationAfterPayment,
} = require("./registration-confirmation-service.js");

/**
 * REQUIRED WORKFLOW (as you specified)
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
 * - If callback status == 1 ⇒ mark PAID immediately (final) (your requirement)
 * - Else do NOT mark FAILED here.
 */

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
 */
async function initiateOnepayPayment(registrationMongoId) {
  if (!mongoose.Types.ObjectId.isValid(registrationMongoId)) {
    throw new HttpError(400, "Invalid registration id.");
  }

  const reg = await Registration.findById(registrationMongoId);
  if (!reg) throw new HttpError(404, "Registration not found.");
  if (reg.paymentStatus === "PAID") throw new HttpError(409, "Registration is already paid.");

  let payment = await Payment.findOne({
    registrationId: reg._id,
    provider: "ONEPAY",
    status: { $in: ["INITIATED", "PENDING"] },
  }).sort({ createdAt: -1 });

  if (!payment) {
    payment = await Payment.create({
      provider: "ONEPAY",
      registrationId: reg._id,
      reference: makeReference(reg),
      currency: process.env.ONEPAY_CURRENCY || "USD",
      amount: reg.feeAmount,
      status: "INITIATED",
      attempts: 0,
    });
  }

  if (payment.status === "PENDING" && payment.redirectUrl) {
    return {
      paymentId: payment._id,
      redirectUrl: payment.redirectUrl,
      onepayTransactionId: payment.onepayTransactionId,
      reused: true,
    };
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
    reg.paymentReference = onepayTransactionId;
    await reg.save();

    return { paymentId: payment._id, redirectUrl, onepayTransactionId, reused: false };
  } catch (err) {
    payment.status = "FAILED";
    payment.lastError = err?.message || "Initiation failed";
    await payment.save().catch(() => {});
    throw err instanceof HttpError ? err : new HttpError(500, "Failed to initiate payment.");
  }
}

/**
 * OnePay status API single check:
 * returns finalStatus: "PAID" | "FAILED" | "PENDING"
 * and data payload.
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

    if (currency && currency !== payment.currency) {
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
 * Status endpoint logic (exactly as requested)
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
            "Payment failed (confirmed by status API).",
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