// src/controllers/staff-dashboard-controller.js
const {
  getStaffDashboardStats,
  listPaidGalaOrders,
  getGalaOrderWithTickets,
  listRedeemedTickets,
} = require("../services/staff-dashboard-service");

function sendError(res, err) {
  const status = err?.statusCode || 500;
  if (status >= 500) console.error(err);
  return res.status(status).json({
    message: err?.message || "Server error",
    ...(err?.details ? { details: err.details } : {}),
  });
}

/** GET /api/staff/dashboard/stats — conference + gala in one payload. */
async function staffDashboardStatsController(req, res) {
  try {
    const data = await getStaffDashboardStats();
    return res.json(data);
  } catch (e) {
    return sendError(res, e);
  }
}

/** GET /api/staff/dashboard/gala/redeemed */
async function redeemedTicketsController(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const data = await listRedeemedTickets({ page, limit });
    return res.json(data);
  } catch (e) {
    return sendError(res, e);
  }
}

/**
 * GET /api/staff/dashboard/gala/orders
 * Filters: ?q=&sortBy=&sortDir=&page=&limit=
 * PAID only — an unpaid order has no valid coupons to redeem.
 */
async function galaOrdersListController(req, res) {
  try {
    const { page, limit, q, sortBy, sortDir } = req.query || {};
    const data = await listPaidGalaOrders({
      page,
      limit,
      q: String(q || "").trim(),
      sortBy: String(sortBy || "").trim() || undefined,
      sortDir: String(sortDir || "").trim() || undefined,
    });
    return res.json(data);
  } catch (e) {
    return sendError(res, e);
  }
}

/** GET /api/staff/dashboard/gala/orders/:galaOrderMongoId/tickets */
async function galaOrderTicketsController(req, res) {
  try {
    const { galaOrderMongoId } = req.params || {};
    const data = await getGalaOrderWithTickets({ galaOrderMongoId });
    return res.json(data);
  } catch (e) {
    return sendError(res, e);
  }
}

module.exports = {
  staffDashboardStatsController,
  redeemedTicketsController,
  galaOrdersListController,
  galaOrderTicketsController,
};
