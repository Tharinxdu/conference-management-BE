// FILE: src/services/registration-directory-service.js
//
// Read-only directory of registrations that are ready for the desk:
// paymentStatus === "PAID" AND a RegistrationQr document exists.
//
// The QR document is the source of truth for "has a QR" (rather than the
// Registration.qr back-link), so a registration whose back-link was never
// written still shows up correctly.
//
// Shared by the admin dashboard and the staff dashboard so both surfaces
// always agree on who is allowed at the venue.

const Registration = require("../models/Registration");
const RegistrationQr = require("../models/RegistrationQr");
const User = require("../models/User");
const { HttpError } = require("../utils/http-error");

// Read the real collection names off the models rather than hardcoding
// Mongoose's pluralisation, so a model rename can't silently break the joins.
const QR_COLLECTION = RegistrationQr.collection.name;
const USER_COLLECTION = User.collection.name;
const REGISTRATION_COLLECTION = Registration.collection.name;

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_EXPORT_ROWS = 20000;

const CHECK_IN_STATUSES = ["CHECKED_IN", "NOT_CHECKED_IN"];

// Whitelisted sort keys -> aggregate sort specs. Anything else is rejected so
// user input can never reach the sort stage verbatim.
const SORT_SPECS = {
  name: (dir) => ({ firstName: dir, lastName: dir, registrationId: 1 }),
  registrationId: (dir) => ({ registrationId: dir }),
  conferenceType: (dir) => ({ conferenceType: dir, firstName: 1, lastName: 1 }),
  checkedInAt: (dir) => ({ "qrDoc.checkedInAt": dir, firstName: 1 }),
  registeredAt: (dir) => ({ createdAt: dir }),
};

const DEFAULT_SORT_BY = "name";
const DEFAULT_SORT_DIR = "asc";

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePage(page) {
  return Math.max(1, Number(page) || 1);
}

function normalizeLimit(limit) {
  const n = Number(limit) || DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, n));
}

function normalizeCheckInStatus(value) {
  const s = String(value || "").trim().toUpperCase();
  if (!s) return null;
  if (!CHECK_IN_STATUSES.includes(s)) {
    throw new HttpError(400, `Invalid checkInStatus. Use one of: ${CHECK_IN_STATUSES.join(", ")}`);
  }
  return s;
}

function normalizeSort(sortBy, sortDir) {
  const key = String(sortBy || DEFAULT_SORT_BY).trim();
  if (!Object.prototype.hasOwnProperty.call(SORT_SPECS, key)) {
    throw new HttpError(400, `Invalid sortBy. Use one of: ${Object.keys(SORT_SPECS).join(", ")}`);
  }

  const dirRaw = String(sortDir || DEFAULT_SORT_DIR).trim().toLowerCase();
  if (dirRaw !== "asc" && dirRaw !== "desc") {
    throw new HttpError(400, "Invalid sortDir. Use 'asc' or 'desc'.");
  }

  return { key, dir: dirRaw === "desc" ? -1 : 1, dirLabel: dirRaw };
}

/**
 * The population every query starts from: PAID registrations joined to their
 * QR document. Deliberately carries NO user filters, so anything derived
 * straight from it (the summary counters) describes the whole event.
 */
function buildBaseStages() {
  return [
    { $match: { paymentStatus: "PAID" } },
    {
      $lookup: {
        from: QR_COLLECTION,
        localField: "_id",
        foreignField: "registration",
        as: "qrDoc",
      },
    },
    // Inner join: drops PAID registrations that never got a QR issued.
    { $unwind: "$qrDoc" },
  ];
}

/**
 * The caller's search text and conference type. Applied only to the branches
 * that produce rows and the row count — never to the summary.
 */
function buildFilterStages({ q, conferenceType }) {
  const stages = [];

  const type = String(conferenceType || "").trim();
  if (type) stages.push({ $match: { conferenceType: type } });

  const query = String(q || "").trim();
  if (query) {
    const rx = new RegExp(escapeRegex(query), "i");
    stages.push({
      $match: {
        $or: [
          { registrationId: rx },
          { firstName: rx },
          { lastName: rx },
          { email: rx },
          { mobile: rx },
          { institution: rx },
        ],
      },
    });
  }

  return stages;
}

/**
 * Stages that turn a matched registration into the row shape the UI renders.
 * Kept out of the count/summary branches so the users lookup only runs for the
 * rows actually returned.
 */
function buildProjectionStages() {
  return [
    {
      $lookup: {
        from: USER_COLLECTION,
        localField: "qrDoc.checkedInBy",
        foreignField: "_id",
        as: "checkedInByDoc",
      },
    },
    { $unwind: { path: "$checkedInByDoc", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        id: { $toString: "$_id" },
        registrationId: 1,
        title: 1,
        firstName: 1,
        lastName: 1,
        designation: 1,
        institution: 1,
        country: 1,
        participantCategory: 1,
        conferenceType: 1,
        email: 1,
        mobile: 1,
        registeredAt: "$createdAt",
        qr: {
          status: "$qrDoc.status",
          issuedAt: "$qrDoc.issuedAt",
          expiresAt: "$qrDoc.expiresAt",
          checkInStatus: "$qrDoc.checkInStatus",
          checkedInAt: "$qrDoc.checkedInAt",
          checkedInByEmail: { $ifNull: ["$checkedInByDoc.email", null] },
        },
      },
    },
  ];
}

/**
 * Conference types present among PAID + QR registrations, for the filter
 * dropdown. Deliberately ignores the active search so the options don't
 * disappear while the user is typing.
 */
async function listConferenceTypes() {
  const rows = await Registration.aggregate([
    { $match: { paymentStatus: "PAID" } },
    {
      $lookup: {
        from: QR_COLLECTION,
        localField: "_id",
        foreignField: "registration",
        as: "qrDoc",
      },
    },
    { $unwind: "$qrDoc" },
    { $group: { _id: "$conferenceType" } },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((r) => r._id).filter(Boolean);
}

/**
 * Paginated directory listing.
 *
 * `total` reflects every active filter (it drives pagination).
 * `summary` deliberately ignores the checkInStatus filter, so the toolbar can
 * show "142 of 380 checked in" for the current search instead of "142 of 142".
 */
async function listPaidRegistrationsWithQr({
  page,
  limit,
  q,
  conferenceType,
  checkInStatus,
  sortBy,
  sortDir,
} = {}) {
  try {
    const safePage = normalizePage(page);
    const safeLimit = normalizeLimit(limit);
    const skip = (safePage - 1) * safeLimit;

    const status = normalizeCheckInStatus(checkInStatus);
    const sort = normalizeSort(sortBy, sortDir);

    const baseStages = buildBaseStages();
    const filterStages = buildFilterStages({ q, conferenceType });
    const statusStages = status ? [{ $match: { "qrDoc.checkInStatus": status } }] : [];

    // Rows and the row count honour every filter; the summary sits on the
    // unfiltered population so the headline counters stay a stable read on the
    // whole event while the operator searches.
    const rowStages = [...filterStages, ...statusStages];

    const [facet] = await Registration.aggregate([
      ...baseStages,
      {
        $facet: {
          items: [
            ...rowStages,
            { $sort: SORT_SPECS[sort.key](sort.dir) },
            { $skip: skip },
            { $limit: safeLimit },
            ...buildProjectionStages(),
          ],
          filteredCount: [...rowStages, { $count: "count" }],
          summary: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                checkedIn: {
                  $sum: { $cond: [{ $eq: ["$qrDoc.checkInStatus", "CHECKED_IN"] }, 1, 0] },
                },
              },
            },
          ],
        },
      },
    ]);

    const items = facet?.items || [];
    const total = facet?.filteredCount?.[0]?.count || 0;
    const summaryTotal = facet?.summary?.[0]?.total || 0;
    const summaryCheckedIn = facet?.summary?.[0]?.checkedIn || 0;

    const conferenceTypes = await listConferenceTypes();

    return {
      page: safePage,
      limit: safeLimit,
      total,
      sortBy: sort.key,
      sortDir: sort.dirLabel,
      items,
      summary: {
        total: summaryTotal,
        checkedIn: summaryCheckedIn,
        notCheckedIn: Math.max(0, summaryTotal - summaryCheckedIn),
      },
      conferenceTypes,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("listPaidRegistrationsWithQr failed:", err);
    throw new HttpError(500, "Failed to load registrations.");
  }
}

/**
 * Same filters as the listing, but every matching row (no pagination).
 * Used by the Excel export so the file always matches what the user is looking at.
 */
async function listPaidRegistrationsWithQrForExport({
  q,
  conferenceType,
  checkInStatus,
  sortBy,
  sortDir,
} = {}) {
  try {
    const status = normalizeCheckInStatus(checkInStatus);
    const sort = normalizeSort(sortBy, sortDir);

    const baseStages = buildBaseStages();
    const filterStages = buildFilterStages({ q, conferenceType });
    const statusStages = status ? [{ $match: { "qrDoc.checkInStatus": status } }] : [];

    return await Registration.aggregate([
      ...baseStages,
      ...filterStages,
      ...statusStages,
      { $sort: SORT_SPECS[sort.key](sort.dir) },
      { $limit: MAX_EXPORT_ROWS },
      ...buildProjectionStages(),
    ]);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("listPaidRegistrationsWithQrForExport failed:", err);
    throw new HttpError(500, "Failed to export registrations.");
  }
}

/**
 * Headline counts for the desk: how many paid delegates hold a QR, and how many
 * of them have walked through the door. Unfiltered — this is the whole event.
 */
async function getPaidRegistrationsSummary() {
  try {
    const [row] = await Registration.aggregate([
      { $match: { paymentStatus: "PAID" } },
      {
        $lookup: {
          from: QR_COLLECTION,
          localField: "_id",
          foreignField: "registration",
          as: "qrDoc",
        },
      },
      { $unwind: "$qrDoc" },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          checkedIn: {
            $sum: { $cond: [{ $eq: ["$qrDoc.checkInStatus", "CHECKED_IN"] }, 1, 0] },
          },
        },
      },
    ]);

    const total = row?.total || 0;
    const checkedIn = row?.checkedIn || 0;

    return { total, checkedIn, notCheckedIn: Math.max(0, total - checkedIn) };
  } catch (err) {
    console.error("getPaidRegistrationsSummary failed:", err);
    throw new HttpError(500, "Failed to load registration stats.");
  }
}

/**
 * Most recent conference check-ins, newest first — one half of the staff
 * dashboard's activity feed.
 */
async function listRecentCheckIns(limit = 10) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));

  try {
    const rows = await RegistrationQr.aggregate([
      { $match: { checkInStatus: "CHECKED_IN", checkedInAt: { $ne: null } } },
      { $sort: { checkedInAt: -1 } },
      { $limit: safeLimit },
      {
        $lookup: {
          from: REGISTRATION_COLLECTION,
          localField: "registration",
          foreignField: "_id",
          as: "reg",
        },
      },
      { $unwind: { path: "$reg", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: USER_COLLECTION,
          localField: "checkedInBy",
          foreignField: "_id",
          as: "actor",
        },
      },
      { $unwind: { path: "$actor", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          registrationId: 1,
          at: "$checkedInAt",
          firstName: "$reg.firstName",
          lastName: "$reg.lastName",
          conferenceType: "$reg.conferenceType",
          byEmail: { $ifNull: ["$actor.email", null] },
        },
      },
    ]);

    return rows;
  } catch (err) {
    console.error("listRecentCheckIns failed:", err);
    throw new HttpError(500, "Failed to load recent check-ins.");
  }
}

module.exports = {
  listPaidRegistrationsWithQr,
  listPaidRegistrationsWithQrForExport,
  listConferenceTypes,
  getPaidRegistrationsSummary,
  listRecentCheckIns,
  CHECK_IN_STATUSES,
  MAX_EXPORT_ROWS,
};
