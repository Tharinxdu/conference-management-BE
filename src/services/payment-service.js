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
 * NOTE:
 * - Payment.registrationId is treated as a Mongo ObjectId reference to Registration (_id).
 *   (Consider renaming in schema later for clarity, but keeping as-is here.)
 */

/**
 * Your desired behavior:
 * - Callback may be noisy (wrong card, retries) -> we only store it for audit
 * - On redirect/status page, we verify with OnePay for up to 1 minute
 * - If OnePay says PAID -> update DB and finalize (QR + email)
 * - Else after 1 minute -> mark FAILED final
 *
 * Key changes vs your current code:
 * 1) FAILED is NOT final during verification window; only PAID stops checks.
 * 2) verifyAndSync() NEVER sets FAILED just because callback says failed.
 * 3) getPaymentStatusForRegistration() performs bounded verification loop (<= 60s),
 *    then sets FAILED if still not PAID.
 */

function safeAlnumDash(input) {
  return String(input || "").replace(/[^A-Za-z0-9\-]/g, "");
}

/**
 * OnePay reference constraint: <= 21 chars (as per your note).
 * We enforce it deterministically by trimming the base part.
 */
function makeReference(reg) {
  const suffix = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase(); // 6 chars
  const base = safeAlnumDash(reg.registrationId);

  // Reserve space for "-" + suffix
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

async function markFailedFinal({ payment, registrationMongoId, reason }) {
  // mark payment failed
  payment.status = "FAILED";
  payment.lastError = reason || payment.lastError || "Payment not completed.";
  await payment.save().catch(() => {});

  // mark registration failed
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

/**
 * Initiate payment (idempotent-ish):
 * - reuse latest INITIATED/PENDING payment for that registration if exists
 * - if PENDING and redirectUrl exists -> return it (handles lost connection)
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

  // If user lost connection after initiate, reuse existing redirect
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
      additionalData: reg.registrationId, // safe tag
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
 * Verify payment with OnePay status API and sync DB.
 * Safe + idempotent.
 *
 * When PAID -> finalize registration (QR + email)
 * Does NOT mark FAILED (callback failures are noisy). Only returns PAID or leaves as PENDING.
 */
async function verifyAndSync(payment) {
  if (!payment.onepayTransactionId) return payment;

  // Only PAID is truly final
  if (payment.status === "PAID") return payment;

  const reg = await Registration.findById(payment.registrationId);
  if (!reg) throw new HttpError(404, "Registration not found for payment.");

  const statusRes = await getTransactionStatus(payment.onepayTransactionId);
  const data = statusRes?.data || {};

  const s = data.status;
  const msg = (data.status_message || data.message || "").toUpperCase();

  const paid =
    s === true ||
    s === 1 ||
    s === "1" ||
    msg.includes("SUCCESS") ||
    msg.includes("PAID");

  const receivedAmountMinor = toMinorUnits(data.amount);
  const expectedAmountMinor = toMinorUnits(payment.amount);
  const currency = data.currency;

  if (paid) {
    // Safety checks (use minor units to avoid float issues)
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

    // Mark payment as paid
    payment.status = "PAID";
    payment.paidAt = data.paid_on ? new Date(data.paid_on) : new Date();
    payment.lastError = null;
    await payment.save();

    // Mark registration as paid
    reg.paymentStatus = "PAID";
    reg.paymentProvider = "ONEPAY";
    reg.paymentReference = payment.onepayTransactionId;
    await reg.save();

    // FINALIZE: issue/reuse QR + send email ONCE (idempotent)
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

    return payment;
  }

  // Not paid: keep PENDING (do not mark FAILED here)
  if (payment.status !== "PENDING") {
    payment.status = "PENDING";
    await payment.save().catch(() => {});
  }
  if (reg.paymentStatus !== "PENDING") {
    reg.paymentStatus = "PENDING";
    reg.paymentProvider = "ONEPAY";
    reg.paymentReference = payment.onepayTransactionId;
    await reg.save().catch(() => {});
  }

  return payment;
}

/**
 * OnePay callback handler:
 * - store callback (audit)
 * - do a single verify attempt (best effort)
 *
 * NOTE: callback can be noisy (wrong card then retry).
 * We do NOT mark FAILED from callback.
 */
async function handleOnepayCallback(body) {
  const txId = body?.transaction_id;
  if (!txId) throw new HttpError(400, "Missing transaction_id.");

  const payment = await Payment.findOne({ onepayTransactionId: txId });
  if (!payment) throw new HttpError(404, "Payment not found for transaction_id.");

  // If already paid, nothing more to do
  if (payment.status === "PAID") {
    return { ok: true, alreadyProcessed: true, status: payment.status };
  }

  payment.lastCallback = {
    transaction_id: body.transaction_id,
    status: body.status,
    status_message: body.status_message,
    additional_data: body.additional_data,
  };
  await payment.save();

  // Best-effort verify once (do not throw gateway errors back as final truth)
  const synced = await verifyAndSync(payment);
  return { ok: true, status: synced.status };
}

/**
 * Status endpoint logic (your requested behavior):
 * - If DB already says PAID -> return immediately
 * - Else verify with OnePay up to 1 minute:
 *    - If PAID -> update DB and return
 *    - Else after 1 minute -> mark FAILED final and return
 *
 * IMPORTANT: This runs when user is redirected to status page.
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

  // If already PAID, return immediately
  if (payment.status === "PAID") return payment;

  // If we don't have a transaction id, we can't verify -> finalize failed
  if (!payment.onepayTransactionId) {
    await markFailedFinal({
      payment,
      registrationMongoId,
      reason: "Missing OnePay transaction id.",
    });
    return await Payment.findById(payment._id);
  }

  const maxMs = 60 * 1000;
  const intervalMs = 5000; // 12 checks in 60s
  const checks = Math.max(1, Math.ceil(maxMs / intervalMs));

  let lastErr = null;

  for (let i = 0; i < checks; i++) {
    try {
      const updated = await verifyAndSync(payment);

      if (updated.status === "PAID") {
        const fresh = await Payment.findById(payment._id);
        return fresh || updated;
      }
    } catch (e) {
      // transient OnePay failures -> keep trying within the 1-minute window
      lastErr = e?.message || String(e);
      payment.lastError = lastErr;
      await payment.save().catch(() => {});
    }

    if (i < checks - 1) {
      await sleep(intervalMs);
    }
  }

  // After 1 minute without PAID -> finalize FAILED
  await markFailedFinal({
    payment,
    registrationMongoId,
    reason: lastErr || "Payment not completed within 1 minute.",
  });

  return await Payment.findById(payment._id);
}

module.exports = {
  initiateOnepayPayment,
  handleOnepayCallback,
  getPaymentStatusForRegistration,
};