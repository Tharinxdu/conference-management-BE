// src/controllers/payment-controller.js

const {
  initiateOnepayPayment,
  handleOnepayCallback,
  getPaymentStatusForRegistration,
} = require("../services/payment-service.js");

const { HttpError } = require("../utils/http-error.js");
const Registration = require("../models/Registration.js");

function sendError(res, err) {
  const status = err?.statusCode || 500;
  return res.status(status).json({
    message: err?.message || "Server error",
    ...(err?.details ? { details: err.details } : {}),
  });
}

function toSafeRegistration(reg) {
  return {
    registrationId: reg.registrationId,

    // Personal (safe)
    title: reg.title,
    firstName: reg.firstName,
    lastName: reg.lastName,
    designation: reg.designation,
    institution: reg.institution,
    country: reg.country,

    // Registration / pricing (safe)
    incomeGroup: reg.incomeGroup,
    participantCategory: reg.participantCategory,
    conferenceType: reg.conferenceType,
    feeAmount: reg.feeAmount,
    feePeriod: reg.feePeriod,

    // Contact (safe enough for the registrant UI)
    email: reg.email,

    // QR indicator (don’t expose internal ObjectId)
    hasQr: Boolean(reg.qr),
  };
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

    // Base response: always safe to send
    const response = {
      paymentStatus: payment.status,
      // onepayTransactionId: payment.onepayTransactionId,
      redirectUrl: payment.redirectUrl,
      paidAt: payment.paidAt,
      lastError: payment.lastError,
    };

    // ✅ Only attach registration details when PAID
    if (payment.status === "PAID") {
      const reg = await Registration.findById(registrationMongoId).select(
        [
          "registrationId",
          "title",
          "firstName",
          "lastName",
          "designation",
          "institution",
          "country",
          "incomeGroup",
          "participantCategory",
          "conferenceType",
          "feeAmount",
          "feePeriod",
          "email",
          "qr",
        ].join(" ")
      );

      if (reg) {
        response.registration = toSafeRegistration(reg);
      }
    }

    return res.status(200).json(response);
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  initiateOnepayPaymentController,
  onepayCallbackController,
  getPaymentStatusForRegistrationController,
};