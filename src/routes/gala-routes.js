const express = require("express");
const {
  createGalaOrderController,
  initiateGalaPaymentController,
  galaCallbackController,
  galaStatusController,
} = require("../controllers/gala-controller");

const router = express.Router();

// Public create order
router.post("/", createGalaOrderController);

// Public initiate payment
router.post("/onepay/initiate", initiateGalaPaymentController);

// OnePay callback
router.post("/onepay/callback", galaCallbackController);

// Status page polling
router.get("/onepay/status/:galaOrderMongoId", galaStatusController);

module.exports = router;