// src/services/staff-dashboard-service.js
const mongoose = require("mongoose");
const GalaOrder = require("../models/GalaOrder");
const GalaTicket = require("../models/GalaTicket");
const { HttpError } = require("../utils/http-error");

// Optional: escape regex input to avoid regex injection / catastrophic patterns
function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Dashboard stats
 * - Tickets counted only for PAID orders
 * - Counts issued (ACTIVE) tickets + redeemed among them
 * - Remaining = issued - redeemed
 */
async function getGalaStats() {
  const [paidOrders, ticketAgg] = await Promise.all([
    GalaOrder.countDocuments({ paymentStatus: "PAID" }),

    GalaTicket.aggregate([
      {
        $lookup: {
          from: "galaorders",
          localField: "order",
          foreignField: "_id",
          as: "orderDoc",
        },
      },
      { $unwind: "$orderDoc" },
      { $match: { "orderDoc.paymentStatus": "PAID" } },

      // issued tickets should be ACTIVE
      { $match: { status: "ACTIVE" } },

      {
        $group: {
          _id: null,
          totalPaidIssued: { $sum: 1 },
          redeemed: {
            $sum: { $cond: [{ $eq: ["$redeemStatus", "REDEEMED"] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  const totalPaidIssued = ticketAgg?.[0]?.totalPaidIssued || 0;
  const redeemed = ticketAgg?.[0]?.redeemed || 0;

  return {
    tickets: {
      totalPaidIssued,
      redeemed,
      remaining: Math.max(0, totalPaidIssued - redeemed),
    },
    orders: {
      paidOrders,
    },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Recent redeemed tickets list (for table)
 */
async function listRedeemedTickets({ page = 1, limit = 25 }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const skip = (safePage - 1) * safeLimit;

  const filter = { redeemStatus: "REDEEMED" };

  const [total, rows] = await Promise.all([
    GalaTicket.countDocuments(filter),
    GalaTicket.find(filter)
      .sort({ redeemedAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("order", "orderId name email ticketCount totalAmount currency paidAt paymentStatus")
      .populate("redeemedBy", "email isAdmin isStaff")
      .lean(),
  ]);

  return {
    page: safePage,
    limit: safeLimit,
    total,
    items: rows.map((t) => ({
      ticketId: t.ticketId,
      redeemedAt: t.redeemedAt,
      buyerName: t.order?.name || null,
      buyerEmail: t.order?.email || null,
      orderId: t.order?.orderId || null,
      redeemedByEmail: t.redeemedBy?.email || null,
    })),
  };
}

/**
 * Paid orders with redemption progress
 */
async function listPaidOrdersWithRedeemProgress({ page = 1, limit = 25, q = "" }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const skip = (safePage - 1) * safeLimit;

  const filter = { paymentStatus: "PAID" };

  const query = String(q || "").trim();
  if (query) {
    const rx = new RegExp(escapeRegex(query), "i");
    filter.$or = [{ orderId: rx }, { email: rx }, { name: rx }];
  }

  const [total, orders] = await Promise.all([
    GalaOrder.countDocuments(filter),
    GalaOrder.find(filter).sort({ paidAt: -1 }).skip(skip).limit(safeLimit).lean(),
  ]);

  const orderIds = orders.map((o) => o._id);

  const redeemedAgg = await GalaTicket.aggregate([
    { $match: { order: { $in: orderIds } } },
    {
      $group: {
        _id: "$order",
        redeemed: {
          $sum: { $cond: [{ $eq: ["$redeemStatus", "REDEEMED"] }, 1, 0] },
        },
      },
    },
  ]);

  const redeemedMap = new Map(redeemedAgg.map((x) => [String(x._id), x.redeemed]));

  return {
    page: safePage,
    limit: safeLimit,
    total,
    items: orders.map((o) => {
      const redeemed = redeemedMap.get(String(o._id)) || 0;
      const ticketCount = Number(o.ticketCount || 0);
      const remaining = Math.max(0, ticketCount - redeemed);

      return {
        orderId: o.orderId,
        buyerName: o.name,
        buyerEmail: o.email,
        ticketCount,
        redeemed,
        remaining,
        totalAmount: o.totalAmount,
        currency: o.currency,
        paidAt: o.paidAt || null,
      };
    }),
  };
}

/* =========================================================
   ✅ NEW FEATURE: Orders list (sorted by buyer name) + expand tickets
========================================================= */

/**
 * List orders by buyer name (for expandable UI).
 * - Supports search q (name/email/orderId)
 * - Supports optional paymentStatus filter (PAID/PENDING/FAILED/UNPAID)
 * - Returns redeemed/remaining counts per order (fast via aggregate)
 */
async function listGalaOrdersByBuyerName({ page = 1, limit = 25, q = "", paymentStatus = null }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const skip = (safePage - 1) * safeLimit;

  const filter = {};
  if (paymentStatus && ["PAID", "PENDING", "FAILED", "UNPAID"].includes(paymentStatus)) {
    filter.paymentStatus = paymentStatus;
  }

  const query = String(q || "").trim();
  if (query) {
    const rx = new RegExp(escapeRegex(query), "i");
    filter.$or = [{ name: rx }, { email: rx }, { orderId: rx }];
  }

  const [total, orders] = await Promise.all([
    GalaOrder.countDocuments(filter),
    GalaOrder.find(filter)
      .sort({ name: 1, createdAt: -1 }) // ✅ buyer name order
      .skip(skip)
      .limit(safeLimit)
      .lean(),
  ]);

  const orderIds = orders.map((o) => o._id);

  // Redeemed count per order (regardless of ticket.status, but you can add status:"ACTIVE" if you want)
  const redeemedAgg = await GalaTicket.aggregate([
    { $match: { order: { $in: orderIds } } },
    {
      $group: {
        _id: "$order",
        redeemed: {
          $sum: { $cond: [{ $eq: ["$redeemStatus", "REDEEMED"] }, 1, 0] },
        },
        totalTickets: { $sum: 1 },
      },
    },
  ]);

  const map = new Map(redeemedAgg.map((x) => [String(x._id), x]));

  return {
    page: safePage,
    limit: safeLimit,
    total,
    items: orders.map((o) => {
      const agg = map.get(String(o._id));
      const redeemed = agg?.redeemed || 0;

      // ticketCount is the authoritative "bought" count
      const ticketCount = Number(o.ticketCount || 0);
      const remaining = Math.max(0, ticketCount - redeemed);

      return {
        galaOrderMongoId: String(o._id),
        orderId: o.orderId,
        buyerName: o.name,
        buyerEmail: o.email,
        ticketCount,
        redeemed,
        remaining,
        paymentStatus: o.paymentStatus,
        totalAmount: o.totalAmount,
        currency: o.currency,
        paidAt: o.paidAt || null,
        createdAt: o.createdAt || null,
      };
    }),
  };
}

/**
 * Expand: fetch one order + all its tickets (with redeemedBy email)
 */
async function getGalaOrderWithTickets({ galaOrderMongoId }) {
  if (!mongoose.Types.ObjectId.isValid(galaOrderMongoId)) {
    throw new HttpError(400, "Invalid gala order id.");
  }

  const order = await GalaOrder.findById(galaOrderMongoId).lean();
  if (!order) throw new HttpError(404, "Gala order not found.");

  const tickets = await GalaTicket.find({ order: order._id })
    .sort({ createdAt: 1 })
    .populate("redeemedBy", "email isAdmin isStaff")
    .lean();

  return {
    order: {
      galaOrderMongoId: String(order._id),
      orderId: order.orderId,
      name: order.name,
      email: order.email,
      ticketCount: order.ticketCount,
      totalAmount: order.totalAmount,
      currency: order.currency,
      paymentStatus: order.paymentStatus,
      paidAt: order.paidAt || null,
      createdAt: order.createdAt || null,
    },
    tickets: tickets.map((t) => ({
      ticketId: t.ticketId,
      status: t.status, // ACTIVE/REVOKED/EXPIRED
      redeemStatus: t.redeemStatus, // REDEEMED/NOT_REDEEMED
      redeemedAt: t.redeemedAt || null,
      redeemedByEmail: t.redeemedBy?.email || null,
      expiresAt: t.expiresAt || null,
    })),
  };
}

module.exports = {
  getGalaStats,
  listRedeemedTickets,
  listPaidOrdersWithRedeemProgress,

  // ✅ NEW
  listGalaOrdersByBuyerName,
  getGalaOrderWithTickets,
};