const express = require("express");
const {
  initiateOnepayPaymentController,
  onepayCallbackController,
  getPaymentStatusForRegistrationController,
  getExchangeRateController,
} = require("../controllers/payment-controller.js");

const router = express.Router();

// Public: indicative USD -> LKR rate for the registration form.
router.get("/exchange-rate", getExchangeRateController);

// Frontend calls this with { registrationMongoId, currency }
router.post("/onepay/initiate", initiateOnepayPaymentController);

// OnePay calls this (configure this URL in OnePay portal)
router.post("/onepay/callback", onepayCallbackController);

// Frontend polls this to recover from lost connection / delayed callback
router.get("/onepay/status/:registrationMongoId", getPaymentStatusForRegistrationController);

module.exports = router;