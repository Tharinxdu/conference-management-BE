// src/services/staff-dashboard-service.js
//
// Everything the staff dashboard needs. Staff now work both doors — conference
// check-in and gala coupon redemption — so the stats cover both, and the
// activity feed interleaves them.

const mongoose = require("mongoose");
const GalaOrder = require("../models/GalaOrder");
const GalaTicket = require("../models/GalaTicket");
const { HttpError } = require("../utils/http-error");
const {
  getPaidRegistrationsSummary,
  listRecentCheckIns,
} = require("./registration-directory-service");

const ORDER_COLLECTION = GalaOrder.collection.name;
const TICKET_COLLECTION = GalaTicket.collection.name;

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const ACTIVITY_LIMIT = 12;

// Whitelisted sort keys so user input never reaches the sort stage verbatim.
const ORDER_SORT_SPECS = {
  buyerName: (dir) => ({ name: dir, createdAt: -1 }),
  orderId: (dir) => ({ orderId: dir }),
  tickets: (dir) => ({ ticketCount: dir, name: 1 }),
  remaining: (dir) => ({ remaining: dir, name: 1 }),
  paidAt: (dir) => ({ paidAt: dir }),
};

const DEFAULT_ORDER_SORT_BY = "buyerName";
const DEFAULT_ORDER_SORT_DIR = "asc";

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeOrderSort(sortBy, sortDir) {
  const key = String(sortBy || DEFAULT_ORDER_SORT_BY).trim();
  if (!Object.prototype.hasOwnProperty.call(ORDER_SORT_SPECS, key)) {
    throw new HttpError(
      400,
      `Invalid sortBy. Use one of: ${Object.keys(ORDER_SORT_SPECS).join(", ")}`
    );
  }

  const dirRaw = String(sortDir || DEFAULT_ORDER_SORT_DIR).trim().toLowerCase();
  if (dirRaw !== "asc" && dirRaw !== "desc") {
    throw new HttpError(400, "Invalid sortDir. Use 'asc' or 'desc'.");
  }

  return { key, dir: dirRaw === "desc" ? -1 : 1, dirLabel: dirRaw };
}

/* =========================================================
   Gala ticket + order aggregates
========================================================= */

/**
 * Ticket totals across PAID orders, plus how far each order has got
 * (untouched / partly redeemed / fully redeemed).
 */
async function getGalaTotals() {
  const [ticketAgg, orderAgg] = await Promise.all([
    GalaTicket.aggregate([
      {
        $lookup: {
          from: ORDER_COLLECTION,
          localField: "order",
          foreignField: "_id",
          as: "orderDoc",
        },
      },
      { $unwind: "$orderDoc" },
      { $match: { "orderDoc.paymentStatus": "PAID", status: "ACTIVE" } },
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

    GalaOrder.aggregate([
      { $match: { paymentStatus: "PAID" } },
      {
        $lookup: {
          from: TICKET_COLLECTION,
          localField: "_id",
          foreignField: "order",
          as: "tickets",
        },
      },
      {
        $project: {
          ticketCount: { $ifNull: ["$ticketCount", 0] },
          redeemed: {
            $size: {
              $filter: {
                input: "$tickets",
                as: "t",
                cond: { $eq: ["$$t.redeemStatus", "REDEEMED"] },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          paidOrders: { $sum: 1 },
          notRedeemedOrders: { $sum: { $cond: [{ $eq: ["$redeemed", 0] }, 1, 0] } },
          fullyRedeemedOrders: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: ["$ticketCount", 0] },
                    { $gte: ["$redeemed", "$ticketCount"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const totalPaidIssued = ticketAgg?.[0]?.totalPaidIssued || 0;
  const redeemed = ticketAgg?.[0]?.redeemed || 0;

  const paidOrders = orderAgg?.[0]?.paidOrders || 0;
  const notRedeemedOrders = orderAgg?.[0]?.notRedeemedOrders || 0;
  const fullyRedeemedOrders = orderAgg?.[0]?.fullyRedeemedOrders || 0;

  return {
    tickets: {
      totalPaidIssued,
      redeemed,
      remaining: Math.max(0, totalPaidIssued - redeemed),
    },
    orders: {
      paidOrders,
      notRedeemedOrders,
      fullyRedeemedOrders,
      partiallyRedeemedOrders: Math.max(
        0,
        paidOrders - notRedeemedOrders - fullyRedeemedOrders
      ),
    },
  };
}

/** Most recent gala redemptions, newest first. */
async function listRecentRedemptions(limit = ACTIVITY_LIMIT) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || ACTIVITY_LIMIT));

  const rows = await GalaTicket.find({ redeemStatus: "REDEEMED", redeemedAt: { $ne: null } })
    .sort({ redeemedAt: -1 })
    .limit(safeLimit)
    .populate("order", "orderId name email")
    .populate("redeemedBy", "email")
    .lean();

  return rows.map((t) => ({
    ticketId: t.ticketId,
    at: t.redeemedAt,
    orderId: t.order?.orderId || null,
    buyerName: t.order?.name || null,
    buyerEmail: t.order?.email || null,
    byEmail: t.redeemedBy?.email || null,
  }));
}

/* =========================================================
   Dashboard
========================================================= */

/**
 * Combined staff dashboard payload: conference check-in progress, gala
 * redemption progress, and one interleaved activity feed.
 */
async function getStaffDashboardStats() {
  try {
    const [registrations, gala, recentCheckIns, recentRedemptions] = await Promise.all([
      getPaidRegistrationsSummary(),
      getGalaTotals(),
      listRecentCheckIns(ACTIVITY_LIMIT),
      listRecentRedemptions(ACTIVITY_LIMIT),
    ]);

    const checkInEvents = recentCheckIns.map((c) => ({
      type: "CHECK_IN",
      at: c.at,
      label: [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "Delegate",
      primaryId: c.registrationId,
      secondary: c.conferenceType || null,
      byEmail: c.byEmail || null,
    }));

    const redeemEvents = recentRedemptions.map((r) => ({
      type: "REDEEM",
      at: r.at,
      label: r.buyerName || "Gala guest",
      primaryId: r.ticketId,
      secondary: r.orderId || null,
      byEmail: r.byEmail || null,
    }));

    const recentActivity = [...checkInEvents, ...redeemEvents]
      .filter((e) => e.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, ACTIVITY_LIMIT);

    return {
      registrations,
      tickets: gala.tickets,
      orders: gala.orders,
      recentActivity,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("getStaffDashboardStats failed:", err);
    throw new HttpError(500, "Failed to load staff dashboard stats.");
  }
}

/* =========================================================
   Gala orders directory (PAID only, mirrors the registrations directory)
========================================================= */

/**
 * Paginated list of PAID gala orders with redemption progress.
 *
 * `total` reflects the active search (it drives pagination); `summary` covers
 * every PAID order regardless of search, so the header reads as event-wide
 * progress rather than progress within a filter.
 */
async function listPaidGalaOrders({ page, limit, q, sortBy, sortDir } = {}) {
  try {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE));
    const skip = (safePage - 1) * safeLimit;

    const sort = normalizeOrderSort(sortBy, sortDir);

    const baseStages = [
      { $match: { paymentStatus: "PAID" } },
      {
        $lookup: {
          from: TICKET_COLLECTION,
          localField: "_id",
          foreignField: "order",
          as: "tickets",
        },
      },
      {
        $addFields: {
          ticketCount: { $ifNull: ["$ticketCount", 0] },
          redeemed: {
            $size: {
              $filter: {
                input: "$tickets",
                as: "t",
                cond: { $eq: ["$$t.redeemStatus", "REDEEMED"] },
              },
            },
          },
        },
      },
      {
        $addFields: {
          remaining: { $max: [0, { $subtract: ["$ticketCount", "$redeemed"] }] },
        },
      },
    ];

    const query = String(q || "").trim();
    const searchStages = [];
    if (query) {
      const rx = new RegExp(escapeRegex(query), "i");
      searchStages.push({
        $match: { $or: [{ name: rx }, { email: rx }, { orderId: rx }] },
      });
    }

    const projectStage = {
      $project: {
        _id: 0,
        galaOrderMongoId: { $toString: "$_id" },
        orderId: 1,
        buyerName: "$name",
        buyerEmail: "$email",
        country: 1,
        ticketCount: 1,
        redeemed: 1,
        remaining: 1,
        totalAmount: 1,
        currency: 1,
        paymentStatus: 1,
        paidAt: { $ifNull: ["$paidAt", null] },
        createdAt: 1,
      },
    };

    const [facet] = await GalaOrder.aggregate([
      ...baseStages,
      {
        $facet: {
          items: [
            ...searchStages,
            { $sort: ORDER_SORT_SPECS[sort.key](sort.dir) },
            { $skip: skip },
            { $limit: safeLimit },
            projectStage,
          ],
          filteredCount: [...searchStages, { $count: "count" }],
          // No searchStages here on purpose: the headline counters describe
          // every paid order, so they stay a stable read while searching.
          summary: [
            {
              $group: {
                _id: null,
                orders: { $sum: 1 },
                tickets: { $sum: "$ticketCount" },
                redeemed: { $sum: "$redeemed" },
              },
            },
          ],
        },
      },
    ]);

    const items = facet?.items || [];
    const total = facet?.filteredCount?.[0]?.count || 0;
    const sumTickets = facet?.summary?.[0]?.tickets || 0;
    const sumRedeemed = facet?.summary?.[0]?.redeemed || 0;

    return {
      page: safePage,
      limit: safeLimit,
      total,
      sortBy: sort.key,
      sortDir: sort.dirLabel,
      items,
      summary: {
        orders: facet?.summary?.[0]?.orders || 0,
        tickets: sumTickets,
        redeemed: sumRedeemed,
        remaining: Math.max(0, sumTickets - sumRedeemed),
      },
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("listPaidGalaOrders failed:", err);
    throw new HttpError(500, "Failed to load gala orders.");
  }
}

/** Expand: one order plus every ticket on it, for the detail row. */
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
      country: order.country,
      ticketCount: order.ticketCount,
      totalAmount: order.totalAmount,
      currency: order.currency,
      paymentStatus: order.paymentStatus,
      paidAt: order.paidAt || null,
      createdAt: order.createdAt || null,
    },
    tickets: tickets.map((t) => ({
      ticketId: t.ticketId,
      status: t.status,
      redeemStatus: t.redeemStatus,
      redeemedAt: t.redeemedAt || null,
      redeemedByEmail: t.redeemedBy?.email || null,
      expiresAt: t.expiresAt || null,
    })),
  };
}

/** Paginated redeemed-ticket log (kept for the existing /gala/redeemed route). */
async function listRedeemedTickets({ page = 1, limit = DEFAULT_PAGE_SIZE } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE));
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

module.exports = {
  getStaffDashboardStats,
  listPaidGalaOrders,
  getGalaOrderWithTickets,
  listRedeemedTickets,
  listRecentRedemptions,
};
