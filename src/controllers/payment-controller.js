// src/controllers/payment-controller.js

const {
  initiateOnepayPayment,
  handleOnepayCallback,
  getPaymentStatusForRegistration,
} = require("../services/payment-service.js");

const { HttpError } = require("../utils/http-error.js");

function sendError(res, err) {
  const status = err?.statusCode || 500;
  return res.status(status).json({
    message: err?.message || "Server error",
    ...(err?.details ? { details: err.details } : {}),
  });
}

async function initiateOnepayPaymentController(req, res) {
  try {
    const { registrationMongoId } = req.body || {};
    if (!registrationMongoId) {
      throw new HttpError(400, "registrationMongoId is required.");
    }

    const result = await initiateOnepayPayment(registrationMongoId);
    return res.status(200).json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

/**
 * OnePay Callback Endpoint
 *
 * OnePay docs: your callback URL should accept POST requests with JSON payload:
 * {
 *   "transaction_id": "WQBV118E584C83CBA50C6",
 *   "status": 1,
 *   "status_message": "SUCCESS",
 *   "additional_data": ""
 * }
 *
 * Recommended approach (what your service already does):
 * - store callback payload for audit
 * - verify/sync by calling OnePay "Get Transaction" status endpoint (server-to-server)
 *
 * IMPORTANT: Respond quickly with 200 to avoid gateway retries/timeouts.
 */
async function onepayCallbackController(req, res) {
  try {
    const body = req.body || {};

    if (!body.transaction_id) {
      throw new HttpError(400, "Missing transaction_id.");
    }

    const result = await handleOnepayCallback(body);

    // Keep response simple/fast; OnePay only needs 200 OK.
    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function getPaymentStatusForRegistrationController(req, res) {
  try {
    const { registrationMongoId } = req.params || {};
    if (!registrationMongoId) {
      throw new HttpError(400, "registrationMongoId is required.");
    }

    const payment = await getPaymentStatusForRegistration(registrationMongoId);

    return res.status(200).json({
      paymentStatus: payment.status,
      onepayTransactionId: payment.onepayTransactionId,
      redirectUrl: payment.redirectUrl,
      paidAt: payment.paidAt,
      lastError: payment.lastError,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  initiateOnepayPaymentController,
  onepayCallbackController,
  getPaymentStatusForRegistrationController,
};