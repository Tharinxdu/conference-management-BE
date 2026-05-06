// src/controllers/staff-dashboard-controller.js
const {
  getGalaStats,
  listRedeemedTickets,
  listPaidOrdersWithRedeemProgress,

  // ✅ NEW
  listGalaOrdersByBuyerName,
  getGalaOrderWithTickets,
} = require("../services/staff-dashboard-service");

function sendError(res, err) {
  const status = err?.statusCode || 500;
  return res.status(status).json({
    message: err?.message || "Server error",
    ...(err?.details ? { details: err.details } : {}),
  });
}

async function galaStatsController(req, res) {
  try {
    const data = await getGalaStats();
    return res.json(data);
  } catch (e) {
    return sendError(res, e);
  }
}

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

async function ordersController(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const q = String(req.query.q || "").trim();
    const data = await listPaidOrdersWithRedeemProgress({ page, limit, q });
    return res.json(data);
  } catch (e) {
    return sendError(res, e);
  }
}

// ✅ NEW: list orders sorted by buyer name
async function galaOrdersListController(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const q = String(req.query.q || "").trim();

    // optional filter: allow staff to view all, or only PAID
    const paymentStatus = String(req.query.paymentStatus || "").trim().toUpperCase() || null;

    const data = await listGalaOrdersByBuyerName({ page, limit, q, paymentStatus });
    return res.json(data);
  } catch (e) {
    return sendError(res, e);
  }
}

// ✅ NEW: order expand → tickets list
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
  galaStatsController,
  redeemedTicketsController,
  ordersController,

  // ✅ NEW
  galaOrdersListController,
  galaOrderTicketsController,
};