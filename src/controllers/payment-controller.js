const {
  initiateOnepayPayment,
  handleOnepayCallback,
  getPaymentStatusForRegistration,
} = require("../services/payment-service.js");

function sendError(res, err) {
  const status = err?.statusCode || 500;
  return res.status(status).json({
    message: err?.message || "Server error",
    ...(err?.details ? { details: err.details } : {}),
  });
}

async function initiateOnepayPaymentController(req, res) {
  try {
    const { registrationMongoId } = req.body;
    const result = await initiateOnepayPayment(registrationMongoId);
    return res.status(200).json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

async function onepayCallbackController(req, res) {
  try {
    const result = await handleOnepayCallback(req.body);
    return res.status(200).json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

async function getPaymentStatusForRegistrationController(req, res) {
  try {
    const payment = await getPaymentStatusForRegistration(req.params.registrationMongoId);
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
