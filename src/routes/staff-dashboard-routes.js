// src/routes/staff-dashboard-routes.js
const express = require("express");
const { requireAuth } = require("../middlewares/auth-middleware");
const { requireStaff } = require("../middlewares/staff-middleware");

const {
  staffListRegistrationsController,
} = require("../controllers/registration-directory-controller");

const {
  staffDashboardStatsController,
  redeemedTicketsController,
  galaOrdersListController,
  galaOrderTicketsController,
} = require("../controllers/staff-dashboard-controller");

const router = express.Router();

// Dashboard: conference check-in + gala redemption + recent activity.
router.get("/stats", requireAuth, requireStaff, staffDashboardStatsController);
// Deprecated alias — kept so an older client build keeps working.
router.get("/gala/stats", requireAuth, requireStaff, staffDashboardStatsController);

// Registration directory (PAID + QR issued) — same service the admin view uses.
// Filters: ?q=&conferenceType=&checkInStatus=&sortBy=&sortDir=&page=&limit=
router.get("/registrations", requireAuth, requireStaff, staffListRegistrationsController);

// Gala orders directory (PAID only). Filters: ?q=&sortBy=&sortDir=&page=&limit=
router.get("/gala/orders", requireAuth, requireStaff, galaOrdersListController);
// Deprecated alias for the same directory.
router.get("/gala/orders/list", requireAuth, requireStaff, galaOrdersListController);

// Expand → tickets for a single order
router.get(
  "/gala/orders/:galaOrderMongoId/tickets",
  requireAuth,
  requireStaff,
  galaOrderTicketsController
);

// Redeemed-ticket log
router.get("/gala/redeemed", requireAuth, requireStaff, redeemedTicketsController);

module.exports = router;
