const express = require("express");
const {
  initiateOnepayPaymentController,
  onepayCallbackController,
  getPaymentStatusForRegistrationController,
} = require("../controllers/payment-controller.js");

const router = express.Router();

// Frontend calls this with { registrationMongoId }
router.post("/onepay/initiate", initiateOnepayPaymentController);

// OnePay calls this (configure this URL in OnePay portal)
router.post("/onepay/callback", onepayCallbackController);

// Frontend polls this to recover from lost connection / delayed callback
router.get("/onepay/status/:registrationMongoId", getPaymentStatusForRegistrationController);

module.exports = router;
