const express = require("express");
const {
  previewGalaQrController,
  confirmGalaQrController,
  previewByTicketIdController,
  confirmByTicketIdController,
} = require("../controllers/gala-redeem-controller");

const { requireAuth } = require("../middlewares/auth-middleware");
const { requireStaff } = require("../middlewares/staff-middleware");

const router = express.Router();

router.post("/scan/preview", requireAuth, requireStaff, previewGalaQrController);
router.post("/scan/confirm", requireAuth, requireStaff, confirmGalaQrController);

router.post("/by-ticket-id/preview", requireAuth, requireStaff, previewByTicketIdController);
router.post("/by-ticket-id/confirm", requireAuth, requireStaff, confirmByTicketIdController);

module.exports = router;