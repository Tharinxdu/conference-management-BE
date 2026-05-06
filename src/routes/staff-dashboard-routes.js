// src/routes/staff-dashboard-routes.js
const express = require("express");
const { requireAuth } = require("../middlewares/auth-middleware");
const { requireStaff } = require("../middlewares/staff-middleware");

const {
  galaStatsController,
  redeemedTicketsController,
  ordersController,

  // ✅ NEW
  galaOrdersListController,
  galaOrderTicketsController,
} = require("../controllers/staff-dashboard-controller");

const router = express.Router();

router.get("/gala/stats", requireAuth, requireStaff, galaStatsController);
router.get("/gala/redeemed", requireAuth, requireStaff, redeemedTicketsController);
router.get("/gala/orders", requireAuth, requireStaff, ordersController);

// ✅ NEW: list orders by buyer name (for expandable list UI)
router.get("/gala/orders/list", requireAuth, requireStaff, galaOrdersListController);

// ✅ NEW: expand → fetch tickets for a single order
router.get("/gala/orders/:galaOrderMongoId/tickets", requireAuth, requireStaff, galaOrderTicketsController);

module.exports = router;