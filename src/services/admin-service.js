// FILE: src/server/services/admin-service.js
const mongoose = require("mongoose");
const Registration = require("../models/Registration");
const AbstractSubmission = require("../models/AbstractSubmission");
const RegistrationQr = require("../models/RegistrationQr");
const { HttpError } = require("../utils/http-error");

function toDateOrNull(v) {
  if (v == null || String(v).trim() === "") return null;
  const d = new Date(v);
  // Invalid Date check
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function buildCreatedAtRange({ from, to }) {
  const fromDate = toDateOrNull(from);
  const toDate = toDateOrNull(to);

  if (from && !fromDate) throw new HttpError(400, "Invalid 'from' date. Use ISO format.");
  if (to && !toDate) throw new HttpError(400, "Invalid 'to' date. Use ISO format.");

  if (fromDate && toDate && fromDate > toDate) {
    throw new HttpError(400, "'from' must be <= 'to'.");
  }

  if (!fromDate && !toDate) return null;

  const range = {};
  if (fromDate) range.$gte = fromDate;
  if (toDate) range.$lte = toDate;

  return range;
}

async function sumRegistrationFeesByStatus(status, createdAtRange) {
  const match = { paymentStatus: status };
  if (createdAtRange) match.createdAt = createdAtRange;

  const rows = await Registration.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: ["$feeAmount", 0] } },
      },
    },
  ]);

  return rows?.[0]?.total || 0;
}

async function countRegistrationsByPaymentStatus(status, createdAtRange) {
  const q = { paymentStatus: status };
  if (createdAtRange) q.createdAt = createdAtRange;
  return Registration.countDocuments(q);
}

async function countAbstractsByStatus(status, createdAtRange) {
  const q = { status };
  if (createdAtRange) q.createdAt = createdAtRange;
  return AbstractSubmission.countDocuments(q);
}

async function getAdminDashboardStats({ from, to } = {}) {
  try {
    const createdAtRange = buildCreatedAtRange({ from, to });

    const regBaseQ = createdAtRange ? { createdAt: createdAtRange } : {};
    const absBaseQ = createdAtRange ? { createdAt: createdAtRange } : {};
    const qrBaseQ = createdAtRange ? { createdAt: createdAtRange } : {};

    const [
      // Registrations
      registrationsTotal,
      registrationsWithQr,
      regPaidCount,
      regPendingCount,
      regUnpaidCount,
      regFailedCount,

      revenuePaid,
      revenuePending,

      // QR / Check-in
      qrTotal,
      qrActive,
      qrRevoked,
      qrExpired,
      checkedInCount,
      notCheckedInCount,

      // Abstracts
      abstractsTotal,
      absSubmitted,
      absUnderReview,
      absApproved,
      absRejected,
    ] = await Promise.all([
      Registration.countDocuments(regBaseQ),
      Registration.countDocuments({ ...regBaseQ, qr: { $ne: null } }),

      countRegistrationsByPaymentStatus("PAID", createdAtRange),
      countRegistrationsByPaymentStatus("PENDING", createdAtRange),
      countRegistrationsByPaymentStatus("UNPAID", createdAtRange),
      countRegistrationsByPaymentStatus("FAILED", createdAtRange),

      sumRegistrationFeesByStatus("PAID", createdAtRange),
      sumRegistrationFeesByStatus("PENDING", createdAtRange),

      RegistrationQr.countDocuments(qrBaseQ),
      RegistrationQr.countDocuments({ ...qrBaseQ, status: "ACTIVE" }),
      RegistrationQr.countDocuments({ ...qrBaseQ, status: "REVOKED" }),
      RegistrationQr.countDocuments({ ...qrBaseQ, status: "EXPIRED" }),
      RegistrationQr.countDocuments({ ...qrBaseQ, checkInStatus: "CHECKED_IN" }),
      RegistrationQr.countDocuments({
        ...qrBaseQ,
        checkInStatus: { $ne: "CHECKED_IN" },
      }),

      AbstractSubmission.countDocuments(absBaseQ),
      countAbstractsByStatus("submitted", createdAtRange),
      countAbstractsByStatus("under-review", createdAtRange),
      countAbstractsByStatus("approved", createdAtRange),
      countAbstractsByStatus("rejected", createdAtRange),
    ]);

    return {
      range: {
        from: from ? new Date(from).toISOString() : null,
        to: to ? new Date(to).toISOString() : null,
      },

      registrations: {
        total: registrationsTotal,
        withQr: registrationsWithQr,
        paymentStatus: {
          PAID: regPaidCount,
          PENDING: regPendingCount,
          UNPAID: regUnpaidCount,
          FAILED: regFailedCount,
        },
      },

      revenue: {
        paidTotal: revenuePaid,
        pendingTotal: revenuePending,
      },

      qr: {
        total: qrTotal,
        status: {
          ACTIVE: qrActive,
          REVOKED: qrRevoked,
          EXPIRED: qrExpired,
        },
        checkin: {
          CHECKED_IN: checkedInCount,
          NOT_CHECKED_IN: notCheckedInCount,
        },
      },

      abstracts: {
        total: abstractsTotal,
        status: {
          submitted: absSubmitted,
          "under-review": absUnderReview,
          approved: absApproved,
          rejected: absRejected,
        },
      },
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("getAdminDashboardStats failed:", err);
    throw new HttpError(500, "Failed to load admin dashboard stats.");
  }
}

module.exports = {
  getAdminDashboardStats,
};
