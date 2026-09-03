const { HttpError } = require("../utils/http-error");
const { createGalaOrder } = require("../services/gala-order-service");
const { initiateGalaPayment, handleGalaCallback, getGalaPaymentStatus } = require("../services/gala-payment-service");
const { getUsdToLkrRate } = require("../services/exchange-rate-service");

function sendError(res, err) {
  const status = err?.statusCode || 500;
  return res.status(status).json({
    message: err?.message || "Server error",
    ...(err?.details ? { details: err.details } : {}),
  });
}

/**
 * Public: indicative USD -> LKR rate so the gala form can show local buyers
 * their rupee total before submitting. Display only — the server re-fetches
 * and locks the rate at initiation.
 */
async function galaExchangeRateController(req, res) {
  try {
    const { rate } = await getUsdToLkrRate();
    return res.status(200).json({ base: "USD", quote: "LKR", rate, indicative: true });
  } catch (err) {
    return sendError(res, err);
  }
}

async function createGalaOrderController(req, res) {
  try {
    const order = await createGalaOrder(req.body);
    return res.status(201).json(order);
  } catch (err) {
    return sendError(res, err);
  }
}

async function initiateGalaPaymentController(req, res) {
  try {
    const { galaOrderMongoId } = req.body || {};
    if (!galaOrderMongoId) throw new HttpError(400, "galaOrderMongoId is required.");
    const result = await initiateGalaPayment(galaOrderMongoId);
    return res.status(200).json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

async function galaCallbackController(req, res) {
  try {
    const body = req.body || {};
    if (!body.transaction_id) throw new HttpError(400, "Missing transaction_id.");
    const result = await handleGalaCallback(body);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return sendError(res, err);
  }
}

async function galaStatusController(req, res) {
  try {
    const { galaOrderMongoId } = req.params || {};
    if (!galaOrderMongoId) throw new HttpError(400, "galaOrderMongoId is required.");
    const order = await getGalaPaymentStatus(galaOrderMongoId);

    // safe response
    return res.status(200).json({
      paymentStatus: order.paymentStatus,
      redirectUrl: order.redirectUrl,
      paidAt: order.paidAt,
      lastError: order.lastError,

      // What was actually charged, so the status page shows the right currency.
      currency: order.currency,
      amount: order.chargedAmount,

      order: order.paymentStatus === "PAID"
        ? {
            orderId: order.orderId,
            name: order.name,
            email: order.email,
            country: order.country,
            ticketCount: order.ticketCount,
            totalAmount: order.totalAmount,
            currency: order.currency,
            chargedAmount: order.chargedAmount,
          }
        : undefined,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  createGalaOrderController,
  initiateGalaPaymentController,
  galaCallbackController,
  galaStatusController,
  galaExchangeRateController,
};