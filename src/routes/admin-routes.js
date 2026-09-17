// FILE: src/server/routes/admin-routes.js
const express = require("express");
const { requireAuth } = require("../middlewares/auth-middleware");
const { requireAdmin } = require("../middlewares/admin-middleware");
const { adminDashboardStatsController } = require("../controllers/admin-controller");
const {
  adminListRegistrationsController,
  adminExportRegistrationsController,
} = require("../controllers/registration-directory-controller");

const router = express.Router();

// Dashboard metrics (counts, revenue, check-ins, abstracts)
router.get("/dashboard", requireAuth, requireAdmin, adminDashboardStatsController);

// Registration directory (PAID + QR issued).
// Filters: ?q=&conferenceType=&checkInStatus=&sortBy=&sortDir=&page=&limit=
// NOTE: keep the export route above any future "/registrations/:id" route.
router.get(
  "/registrations/export/excel",
  requireAuth,
  requireAdmin,
  adminExportRegistrationsController
);
router.get("/registrations", requireAuth, requireAdmin, adminListRegistrationsController);

module.exports = router;
