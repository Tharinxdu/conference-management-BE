// FILE: src/server/routes/admin-routes.js
const express = require("express");
const { requireAuth } = require("../middlewares/auth-middleware");
const { requireAdmin } = require("../middlewares/admin-middleware");
const { adminDashboardStatsController } = require("../controllers/admin-controller");

const router = express.Router();

// Dashboard metrics (counts, revenue, check-ins, abstracts)
router.get("/dashboard", requireAuth, requireAdmin, adminDashboardStatsController);

module.exports = router;
