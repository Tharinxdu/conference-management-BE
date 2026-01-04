const { HttpError } = require("../utils/http-error");

const LOCKED_STATUSES = new Set(["under-review", "approved", "rejected"]);

function wordCount(text = "") {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function normalizeKeywords(input) {
  // accept array OR comma-separated string
  if (Array.isArray(input)) return input.map((k) => String(k).trim()).filter(Boolean);
  if (typeof input === "string") {
    return input.split(",").map((k) => k.trim()).filter(Boolean);
  }
  return [];
}

function parseCoAuthors(raw = "") {
  const lines = String(raw).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const result = [];

  for (const line of lines) {
    // format: Full Name – Institution – Country – Email
    const parts = line.split("–").map((p) => p.trim());
    if (parts.length < 1) continue;

    result.push({
      fullName: parts[0] || "",
      institution: parts[1] || "",
      country: parts[2] || "",
      email: (parts[3] || "").toLowerCase(),
      rawLine: line,
    });
  }

  return { coAuthorsRaw: lines.join("\n"), coAuthors: result };
}

function ensureAtLeastOne(arr, msg) {
  if (!Array.isArray(arr) || arr.length < 1) throw new HttpError(400, msg);
}

function validateDeclarations(decls = {}) {
  const ok =
    decls.originalWork === true &&
    decls.authorsApproved === true &&
    decls.agreeProceedings === true;

  if (!ok) {
    throw new HttpError(400, "All declarations must be accepted to submit.");
  }
}

function sanitizeUserAbstractUpdates(updates = {}) {
  // Users cannot change owner/profile/declarationsAcceptedAt directly, etc.
  const disallowed = new Set([
    "owner",
    "presentingAuthorProfile",
    "attachments",
    "declarations",
    "status",
    "_id",
    "__v",
    "createdAt",
    "updatedAt",
  ]);

  const safe = {};
  for (const [k, v] of Object.entries(updates || {})) {
    if (disallowed.has(k)) continue;
    safe[k] = v;
  }
  return safe;
}

function buildAttachmentUrl(req, storedName) {
  return `${req.protocol}://${req.get("host")}/uploads/abstracts/${storedName}`;
}

function toAbstractDTO(doc, req, opts = {}) {
  const includeDeclarations = !!opts.includeDeclarations;
  const obj = doc.toObject ? doc.toObject() : doc;

  // return links for attachments
  const attachments = (obj.attachments || []).map((a) => ({
    _id: a._id,
    originalName: a.originalName,
    mimeType: a.mimeType,
    size: a.size,
    uploadedAt: a.uploadedAt,
    url: buildAttachmentUrl(req, a.storedName),
  }));

  const dto = {
    _id: obj._id,
    owner: obj.owner,
    presentingAuthorProfile: obj.presentingAuthorProfile,

    presentingAuthorName: obj.presentingAuthorName,
    correspondingAuthorName: obj.correspondingAuthorName,
    correspondingAuthorEmail: obj.correspondingAuthorEmail,

    abstractTitle: obj.abstractTitle,
    preferredPresentationTypes: obj.preferredPresentationTypes,
    scientificCategories: obj.scientificCategories,
    otherCategoryText: obj.otherCategoryText,

    abstractText: obj.abstractText,
    keywords: obj.keywords,

    coAuthorsRaw: obj.coAuthorsRaw,
    coAuthors: obj.coAuthors,

    attachments,
    status: obj.status,

    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };

  if (includeDeclarations) dto.declarations = obj.declarations;

  return dto;
}

function assertUserCanModify(doc) {
  const status = String(doc?.status || "").toLowerCase();
  // allow only when still "submitted"
  if (status && status !== "submitted" && LOCKED_STATUSES.has(status)) {
    throw new HttpError(
      409,
      `This abstract is ${status} and can no longer be modified. You can only view it.`
    );
  }
  // If status is missing/unexpected, be safe: block edits unless explicitly submitted
  if (status !== "submitted") {
    throw new HttpError(
      409,
      `This abstract is ${status || "not editable"} and can no longer be modified. You can only view it.`
    );
  }
}

module.exports = {
  wordCount,
  normalizeKeywords,
  parseCoAuthors,
  ensureAtLeastOne,
  validateDeclarations,
  sanitizeUserAbstractUpdates,
  toAbstractDTO,
  assertUserCanModify,
};
