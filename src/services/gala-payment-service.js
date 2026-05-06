// src/services/gala-payment-service.js
const mongoose = require("mongoose");
const crypto = require("crypto");

const { HttpError } = require("../utils/http-error");
const {
  createGalaCheckoutLink,
  getGalaTransactionStatus,
} = require("../utils/onepay-client-gala"); 
const GalaOrder = require("../models/GalaOrder");

const { finalizeGalaOrderAfterPayment } = require("./gala-finalize-service");

function safeAlnumDash(input) {
  return String(input || "").replace(/[^A-Za-z0-9\-]/g, "");
}

function makeReference(order) {
  const suffix = crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  const base = safeAlnumDash(order.orderId);
  const maxBaseLen = 21 - (1 + suffix.length);
  const trimmedBase = base.slice(0, Math.max(0, maxBaseLen)) || "GALA";
  return `${trimmedBase}-${suffix}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function callbackIsPaid(body) {
  return body?.status !== undefined && Number(body.status) === 1;
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

function toMinorUnits(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

async function markPaidFinal({ order, paidAt }) {
  order.paymentStatus = "PAID";
  order.paidAt = order.paidAt || paidAt || new Date();
  order.lastError = null;
  await order.save();

  // finalize (issue QRs + email) – should be idempotent
  try {
    await finalizeGalaOrderAfterPayment({
      galaOrderMongoId: order._id,
      paymentReference: order.onepayTransactionId,
      paymentProvider: "ONEPAY_GALA",
    });
  } catch (e) {
    order.lastError = `Finalize failed: ${e?.message || "unknown"}`;
    await order.save().catch(() => {});
  }
}

async function markFailedFinal({ order, reason }) {
  order.paymentStatus = "FAILED";
  order.lastError = reason || "Payment not completed.";
  await order.save().catch(() => {});
}

/**
 * Initiate OnePay for a Gala Order
 * - Uses GALA OnePay APP (separate app_id/token/salt)
 * - Reuses pending redirectUrl if exists
 */
async function initiateGalaPayment(galaOrderMongoId) {
  if (!mongoose.Types.ObjectId.isValid(galaOrderMongoId)) {
    throw new HttpError(400, "Invalid gala order id.");
  }

  const order = await GalaOrder.findById(galaOrderMongoId);
  if (!order) throw new HttpError(404, "Gala order not found.");
  if (order.paymentStatus === "PAID") throw new HttpError(409, "Order is already paid.");

  // Reuse if pending
  if (order.paymentStatus === "PENDING" && order.redirectUrl) {
    return {
      galaOrderMongoId: order._id,
      redirectUrl: order.redirectUrl,
      onepayTransactionId: order.onepayTransactionId,
      reused: true,
    };
  }

  const baseRedirect = process.env.ONEPAY_GALA_REDIRECT_URL;
  if (!baseRedirect) throw new HttpError(500, "Missing env var: ONEPAY_GALA_REDIRECT_URL");

  const transactionRedirectUrl = `${baseRedirect}?gid=${encodeURIComponent(
    String(order._id)
  )}`;

  const reference = order.paymentReference || makeReference(order);

  const { onepayTransactionId, redirectUrl } = await createGalaCheckoutLink({
    amount: order.totalAmount,
    currency: "USD",
    reference,
    customer: {
      firstName: order.name || "N/A",
      lastName: "N/A",
      phone: "N/A",
      email: order.email,
    },
    transactionRedirectUrl,
    additionalData: order.orderId,
  });

  order.onepayTransactionId = onepayTransactionId;
  order.redirectUrl = redirectUrl;
  order.paymentProvider = "ONEPAY_GALA";
  order.paymentReference = onepayTransactionId;
  order.paymentStatus = "PENDING";
  order.lastError = null;

  // optional: attempts counter if you have it in schema
  if (typeof order.attempts === "number") order.attempts += 1;

  await order.save();

  return {
    galaOrderMongoId: order._id,
    redirectUrl,
    onepayTransactionId,
    reused: false,
  };
}

/**
 * Callback: store payload; if PAID -> mark PAID immediately (final)
 */
async function handleGalaCallback(body) {
  const txId = body?.transaction_id;
  if (!txId) throw new HttpError(400, "Missing transaction_id.");

  const order = await GalaOrder.findOne({ onepayTransactionId: txId });
  if (!order) throw new HttpError(404, "Gala order not found for transaction_id.");

  order.lastCallback = {
    transaction_id: body.transaction_id,
    status: body.status,
    status_message: body.status_message,
    additional_data: body.additional_data,
  };
  await order.save();

  // If callback says PAID -> finalize PAID immediately
  if (callbackIsPaid(body)) {
    await markPaidFinal({ order, paidAt: new Date() });
    return { ok: true, status: "PAID", source: "callback" };
  }

  // Keep pending (do not mark FAILED here)
  order.paymentStatus = "PENDING";
  order.lastError = body.status_message || null;
  await order.save().catch(() => {});

  return { ok: true, status: "PENDING", source: "callback" };
}

/**
 * Status page: verify with OnePay up to 20s (unless already PAID)
 * Same logic style as your main registration payment-service.
 */
async function getGalaPaymentStatus(galaOrderMongoId) {
  if (!mongoose.Types.ObjectId.isValid(galaOrderMongoId)) {
    throw new HttpError(400, "Invalid gala order id.");
  }

  const order = await GalaOrder.findById(galaOrderMongoId);
  if (!order) throw new HttpError(404, "Gala order not found.");

  // 1) If already PAID ⇒ return
  if (order.paymentStatus === "PAID") return order;

  // 2) If callback was PAID but DB not yet PAID ⇒ mark PAID immediately
  if (order.lastCallback?.status !== undefined && Number(order.lastCallback.status) === 1) {
    await markPaidFinal({ order, paidAt: new Date() });
    return await GalaOrder.findById(order._id);
  }

  // Can't verify without tx id
  if (!order.onepayTransactionId) {
    await markFailedFinal({ order, reason: "Missing OnePay transaction id." });
    return await GalaOrder.findById(order._id);
  }

  // 3) Verify with status API up to 20 seconds
  const maxMs = 20 * 1000;
  const intervalMs = 4000; // ~5 checks
  const checks = Math.max(1, Math.ceil(maxMs / intervalMs));

  let lastErr = null;

  for (let i = 0; i < checks; i++) {
    try {
      const statusRes = await getGalaTransactionStatus(order.onepayTransactionId);
      const data = statusRes?.data || {};
      const finalStatus = normalizeStatusFromOnepay(data);

      if (finalStatus === "PAID") {
        // validate amount/currency
        const receivedMinor = toMinorUnits(data.amount);
        const expectedMinor = toMinorUnits(order.totalAmount);

        if (
          receivedMinor !== null &&
          expectedMinor !== null &&
          receivedMinor !== expectedMinor
        ) {
          throw new HttpError(409, "Payment amount mismatch. Manual review required.");
        }

        if (data.currency && String(data.currency).toUpperCase() !== "USD") {
          throw new HttpError(409, "Payment currency mismatch. Manual review required.");
        }

        await markPaidFinal({
          order,
          paidAt: data.paid_on ? new Date(data.paid_on) : new Date(),
        });

        return await GalaOrder.findById(order._id);
      }

      if (finalStatus === "FAILED") {
        await markFailedFinal({
          order,
          reason:
            data.status_message ||
            data.message ||
            "Payment failed (confirmed by status API).",
        });
        return await GalaOrder.findById(order._id);
      }

      // else PENDING -> keep looping
    } catch (e) {
      lastErr = e?.message || String(e);
      order.lastError = lastErr;
      await order.save().catch(() => {});
    }

    if (i < checks - 1) await sleep(intervalMs);
  }

  // 4) Not confirmed within 20 sec -> FAILED final
  await markFailedFinal({
    order,
    reason: lastErr || "Payment not confirmed within 20 seconds.",
  });

  return await GalaOrder.findById(order._id);
}

module.exports = {
  initiateGalaPayment,
  handleGalaCallback,
  getGalaPaymentStatus,
};