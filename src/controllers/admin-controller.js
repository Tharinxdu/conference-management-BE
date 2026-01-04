// FILE: src/server/controllers/admin-controller.js
const { getAdminDashboardStats } = require("../services/admin-service");
const { HttpError } = require("../utils/http-error");

function sendError(res, err) {
  const status = err?.statusCode || 500;
  if (status >= 500) console.error(err);
  return res.status(status).json({
    message: err?.message || "Server error",
    ...(err?.details ? { details: err.details } : {}),
  });
}

/**
 * GET /api/admin/dashboard
 * Optional query:
 *  - from=2026-01-01T00:00:00.000Z
 *  - to=2026-01-31T23:59:59.999Z
 */
async function adminDashboardStatsController(req, res) {
  try {
    const { from, to } = req.query;

    const stats = await getAdminDashboardStats({ from, to });
    return res.json(stats);
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  adminDashboardStatsController,
};
