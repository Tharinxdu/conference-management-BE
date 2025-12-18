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

function isFinal(status) {
  return status === "PAID" || status === "FAILED" || status === "CANCELED";
}

function makeReference(reg) {
  const suffix = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  return `${reg.registrationId}-${suffix}`; // <= 21 chars required by OnePay reference constraint
}

/**
 * Initiate payment (idempotent):
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
      transactionRedirectUrl: process.env.ONEPAY_TRANSACTION_REDIRECT_URL,
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
 * ✅ UPDATED: When PAID -> finalize registration (QR + email)
 */
async function verifyAndSync(payment) {
  if (!payment.onepayTransactionId) return payment;
  if (isFinal(payment.status)) return payment;

  const reg = await Registration.findById(payment.registrationId);
  if (!reg) throw new HttpError(404, "Registration not found for payment.");

  const statusRes = await getTransactionStatus(payment.onepayTransactionId);
  const data = statusRes?.data || {};

  const paid = data.status === true;
  const amount = Number(data.amount);
  const currency = data.currency;

  if (paid) {
    // Safety checks
    if (Number.isFinite(amount) && amount !== Number(payment.amount)) {
      throw new HttpError(409, "Payment amount mismatch. Manual review required.");
    }
    if (currency && currency !== payment.currency) {
      throw new HttpError(409, "Payment currency mismatch. Manual review required.");
    }

    // Mark payment as paid
    payment.status = "PAID";
    payment.paidAt = data.paid_on ? new Date(data.paid_on) : new Date();
    await payment.save();

    // Mark registration as paid
    reg.paymentStatus = "PAID";
    reg.paymentProvider = "ONEPAY";
    reg.paymentReference = payment.onepayTransactionId;
    await reg.save();

    // ✅ FINALIZE: issue/reuse QR + send email ONCE (idempotent)
    // IMPORTANT: do NOT fail the whole callback/poll if email fails
    try {
      await finalizeRegistrationAfterPayment({
        registrationMongoId: reg._id,
        paymentReference: payment.onepayTransactionId,
        paymentProvider: "ONEPAY",
      });
    } catch (e) {
      console.error("finalizeRegistrationAfterPayment failed:", e);
      // optional: store for diagnostics
      payment.lastError = `Finalize failed: ${e?.message || "unknown"}`;
      await payment.save().catch(() => {});
    }

    return payment;
  }

  // Not paid: keep pending unless callback hinted failure
  if (payment.lastCallback && payment.lastCallback.status !== undefined) {
    const cbStatus = Number(payment.lastCallback.status);
    if (cbStatus !== 1) {
      payment.status = "FAILED";
      payment.lastError = payment.lastCallback.status_message || "Payment not completed.";
      await payment.save();

      reg.paymentStatus = "FAILED";
      reg.paymentProvider = "ONEPAY";
      reg.paymentReference = payment.onepayTransactionId;
      await reg.save();
    }
  }

  return payment;
}

/**
 * OnePay callback handler:
 * - store callback
 * - verify with status endpoint
 */
async function handleOnepayCallback(body) {
  const txId = body?.transaction_id;
  if (!txId) throw new HttpError(400, "Missing transaction_id.");

  const payment = await Payment.findOne({ onepayTransactionId: txId });
  if (!payment) throw new HttpError(404, "Payment not found for transaction_id.");

  if (isFinal(payment.status)) {
    return { ok: true, alreadyProcessed: true, status: payment.status };
  }

  payment.lastCallback = {
    transaction_id: body.transaction_id,
    status: body.status,
    status_message: body.status_message,
    additional_data: body.additional_data,
  };
  await payment.save();

  const synced = await verifyAndSync(payment);
  return { ok: true, status: synced.status };
}

/**
 * Frontend polling endpoint:
 * - fetch latest payment and verify if still pending
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

  if (payment.status === "PENDING") {
    await verifyAndSync(payment);
    const fresh = await Payment.findById(payment._id);
    return fresh;
  }

  return payment;
}

module.exports = {
  initiateOnepayPayment,
  handleOnepayCallback,
  getPaymentStatusForRegistration,
};
