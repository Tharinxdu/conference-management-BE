const express = require("express");
const { previewQrController, confirmQrController, previewByRegistrationIdController,
    checkInByRegistrationIdController, } = require("../controllers/checkin-controller");
const { requireAuth } = require("../middlewares/auth-middleware");
const { requireAdmin } = require("../middlewares/admin-middleware");

const router = express.Router();

// Staff/Admin scans QR -> PREVIEW (no DB write)
router.post("/scan/preview", requireAuth, requireAdmin, previewQrController);

// Staff/Admin confirms -> DB write
router.post("/scan/confirm", requireAuth, requireAdmin, confirmQrController);

router.post("/by-registration-id/preview", requireAuth, requireAdmin, previewByRegistrationIdController);
router.post("/by-registration-id/confirm", requireAuth, requireAdmin, checkInByRegistrationIdController);

module.exports = router;
