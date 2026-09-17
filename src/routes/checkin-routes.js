const express = require("express");
const {
  previewQrController,
  confirmQrController,
  previewByRegistrationIdController,
  checkInByRegistrationIdController,
} = require("../controllers/checkin-controller");
const { requireAuth } = require("../middlewares/auth-middleware");
const { requireStaff } = require("../middlewares/staff-middleware");

const router = express.Router();

// Conference check-in is a desk operation: staff run it, admins can too.
// requireStaff already lets isAdmin through, so admin access is unchanged.

// Scan QR -> PREVIEW (no DB write)
router.post("/scan/preview", requireAuth, requireStaff, previewQrController);

// Confirm -> DB write
router.post("/scan/confirm", requireAuth, requireStaff, confirmQrController);

// Fallback when the QR can't be scanned: look up by registration ID
router.post("/by-registration-id/preview", requireAuth, requireStaff, previewByRegistrationIdController);
router.post("/by-registration-id/confirm", requireAuth, requireStaff, checkInByRegistrationIdController);

module.exports = router;
