const mongoose = require("mongoose");
const fs = require("fs/promises");
const path = require("path");
const AbstractSubmission = require("../models/AbstractSubmission");
const PresentingAuthorProfile = require("../models/PresentingAuthorProfile");
const EmailService = require("./email-service");
const { HttpError } = require("../utils/http-error");
const {
  wordCount,
  normalizeKeywords,
  parseCoAuthors,
  ensureAtLeastOne,
  validateDeclarations,
  sanitizeUserAbstractUpdates,
  assertUserCanModify,
} = require("../helpers/abstract-helper");

const ABSTRACT_UPLOAD_DIR = path.join(__dirname, "..", "uploads", "abstracts");

/* =========================================================
   Abstract submission closure switch

   Default is CLOSED because submission date is over.

   What this blocks for normal users:
   - creating new abstracts
   - editing abstracts
   - adding/removing attachments
   - deleting abstracts
   - all-in-one save/update

   What stays open:
   - list/view existing abstracts
   - admin review/status actions

   To reopen submissions later, add this to .env:
   ABSTRACT_SUBMISSIONS_CLOSED=false
   ========================================================= */
const ABSTRACT_SUBMISSIONS_CLOSED =
  String(process.env.ABSTRACT_SUBMISSIONS_CLOSED ?? "true").toLowerCase() === "true";

const ABSTRACT_CLOSED_MESSAGE =
  process.env.ABSTRACT_CLOSED_MESSAGE ||
  "Abstract submission period is closed. You can only view submitted abstracts.";

function assertAbstractSubmissionsOpen() {
  if (ABSTRACT_SUBMISSIONS_CLOSED) {
    throw new HttpError(403, ABSTRACT_CLOSED_MESSAGE);
  }
}

function ensureAuthUser(user) {
  if (!user?._id) throw new HttpError(401, "Not authenticated");
}

async function getProfileIdForUser(userId) {
  const profile = await PresentingAuthorProfile.findOne({ userId }).select(
    "_id firstName lastName email"
  );

  if (!profile) {
    throw new HttpError(409, "Profile is required before submitting abstracts.");
  }

  return profile;
}

/* =========================================================
   Multipart normalization helpers
   ========================================================= */

function coerceStringArray(raw) {
  if (raw == null) return [];

  if (Array.isArray(raw)) {
    return raw.filter(Boolean).map(String);
  }

  if (typeof raw === "string") {
    const s = raw.trim();

    if (!s) return [];

    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const parsed = JSON.parse(s);

        if (Array.isArray(parsed)) {
          return parsed.filter(Boolean).map(String);
        }
      } catch {
        // fall through
      }
    }

    if (s.includes(",")) {
      return s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    }

    return [s];
  }

  return [];
}

function readArrayField(payload, key) {
  const raw = payload?.[key] ?? payload?.[`${key}[]`];
  return coerceStringArray(raw);
}

function parseJsonIfString(v) {
  if (v == null) return v;
  if (typeof v !== "string") return v;

  const s = v.trim();

  if (!s) return v;

  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

function normalizeInboundPayload(payload) {
  const p = payload || {};

  p.preferredPresentationTypes = readArrayField(p, "preferredPresentationTypes");
  p.scientificCategories = readArrayField(p, "scientificCategories");
  p.keywords = readArrayField(p, "keywords");
  p.declarations = parseJsonIfString(p.declarations);

  return p;
}

function applyBusinessValidation(payload, { requireDecls }) {
  payload = normalizeInboundPayload(payload);

  const required = [
    "presentingAuthorName",
    "correspondingAuthorName",
    "abstractTitle",
    "abstractText",
  ];

  for (const f of required) {
    if (!payload?.[f]) {
      throw new HttpError(400, `Missing required field: ${f}`);
    }
  }

  ensureAtLeastOne(
    payload.preferredPresentationTypes,
    "Select at least one presentation type."
  );

  ensureAtLeastOne(
    payload.scientificCategories,
    "Select at least one scientific category."
  );

  if (
    payload.scientificCategories?.includes("OTHER") &&
    !payload.otherCategoryText
  ) {
    throw new HttpError(
      400,
      "Other category text is required when selecting OTHER."
    );
  }

  if (wordCount(payload.abstractText) > 300) {
    throw new HttpError(400, "Abstract text must be 300 words or less.");
  }

  const keywords = normalizeKeywords(payload.keywords);

  if (keywords.length < 1) {
    throw new HttpError(400, "Keywords are required.");
  }

  if (keywords.length > 5) {
    throw new HttpError(400, "Maximum 5 keywords allowed.");
  }

  if (requireDecls) {
    validateDeclarations(payload.declarations);
  }

  return { keywords, payload };
}

async function createAbstract(user, payload, files = []) {
  try {
    ensureAuthUser(user);
    assertAbstractSubmissionsOpen();

    const profile = await getProfileIdForUser(user._id);

    const { keywords, payload: normalized } = applyBusinessValidation(payload, {
      requireDecls: true,
    });

    const { coAuthorsRaw, coAuthors } = parseCoAuthors(
      normalized.coAuthorsRaw || ""
    );

    const attachments = (files || []).map((f) => ({
      originalName: f.originalname,
      storedName: f.filename,
      mimeType: f.mimetype,
      size: f.size,
    }));

    const doc = await AbstractSubmission.create({
      owner: user._id,
      presentingAuthorProfile: profile._id,

      presentingAuthorName: normalized.presentingAuthorName,
      correspondingAuthorName: normalized.correspondingAuthorName,
      correspondingAuthorEmail: normalized.correspondingAuthorEmail || "",

      abstractTitle: normalized.abstractTitle,
      preferredPresentationTypes: normalized.preferredPresentationTypes,
      scientificCategories: normalized.scientificCategories,
      otherCategoryText: normalized.otherCategoryText || "",

      abstractText: normalized.abstractText,
      keywords,

      coAuthorsRaw,
      coAuthors,

      declarations: {
        originalWork: true,
        authorsApproved: true,
        agreeProceedings: true,
        acceptedAt: new Date(),
      },

      attachments,
      status: "submitted",

      submittedAt: new Date(),
      submissionEmailSentAt: null,
    });

    if (!doc.submissionEmailSentAt) {
      const firstName =
        profile?.firstName ||
        String(normalized.presentingAuthorName || "Author").split(" ")[0];

      await EmailService.sendAbstractSubmitted({
        to: user.email,
        firstName,
        abstractId: doc._id.toString(),
        abstractTitle: doc.abstractTitle,
        presentation: (doc.preferredPresentationTypes || []).join(", "),
      });

      doc.submissionEmailSentAt = new Date();
      await doc.save();
    }

    return doc;
  } catch (err) {
    if (err instanceof HttpError) throw err;

    if (err?.name === "ValidationError") {
      throw new HttpError(400, "Invalid abstract data.", err?.errors);
    }

    console.error("createAbstract failed:", err);
    throw new HttpError(500, "Failed to create abstract.");
  }
}

async function listMyAbstracts(user) {
  try {
    ensureAuthUser(user);

    return await AbstractSubmission.find({ owner: user._id }).sort({
      createdAt: -1,
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;

    console.error("listMyAbstracts failed:", err);
    throw new HttpError(500, "Failed to fetch abstracts.");
  }
}

async function getMyAbstractById(user, id) {
  try {
    ensureAuthUser(user);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid abstract id.");
    }

    const doc = await AbstractSubmission.findOne({
      _id: id,
      owner: user._id,
    });

    if (!doc) {
      throw new HttpError(404, "Abstract not found");
    }

    return doc;
  } catch (err) {
    if (err instanceof HttpError) throw err;

    console.error("getMyAbstractById failed:", err);
    throw new HttpError(500, "Failed to fetch abstract.");
  }
}

async function updateMyAbstract(user, id, updates) {
  try {
    ensureAuthUser(user);
    assertAbstractSubmissionsOpen();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid abstract id.");
    }

    const current = await AbstractSubmission.findOne({
      _id: id,
      owner: user._id,
    });

    if (!current) {
      throw new HttpError(404, "Abstract not found");
    }

    assertUserCanModify(current);

    const safe = sanitizeUserAbstractUpdates(updates);

    const merged = {
      ...current.toObject(),
      ...safe,
    };

    const { keywords } = applyBusinessValidation(merged, {
      requireDecls: false,
    });

    safe.keywords = keywords;

    const parsed = parseCoAuthors(
      safe.coAuthorsRaw ?? merged.coAuthorsRaw ?? ""
    );

    safe.coAuthorsRaw = parsed.coAuthorsRaw;
    safe.coAuthors = parsed.coAuthors;

    const updated = await AbstractSubmission.findOneAndUpdate(
      { _id: id, owner: user._id },
      { ...safe, status: "updated" },
      { new: true, runValidators: true }
    );

    return updated;
  } catch (err) {
    if (err instanceof HttpError) throw err;

    if (err?.name === "ValidationError") {
      throw new HttpError(400, "Invalid update data.", err?.errors);
    }

    console.error("updateMyAbstract failed:", err);
    throw new HttpError(500, "Failed to update abstract.");
  }
}

async function deleteMyAbstract(user, id) {
  try {
    ensureAuthUser(user);
    assertAbstractSubmissionsOpen();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid abstract id.");
    }

    const doc = await AbstractSubmission.findOne({
      _id: id,
      owner: user._id,
    });

    if (!doc) {
      throw new HttpError(404, "Abstract not found");
    }

    assertUserCanModify(doc);

    await AbstractSubmission.deleteOne({
      _id: id,
      owner: user._id,
    });

    return {
      ok: true,
      message: "Abstract deleted",
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;

    console.error("deleteMyAbstract failed:", err);
    throw new HttpError(500, "Failed to delete abstract.");
  }
}

async function saveMyAbstractAllInOne(
  user,
  abstractId,
  updates = {},
  removeAttachmentIds = [],
  files = []
) {
  ensureAuthUser(user);
  assertAbstractSubmissionsOpen();

  if (!mongoose.Types.ObjectId.isValid(abstractId)) {
    throw new HttpError(400, "Invalid abstract id.");
  }

  const doc = await AbstractSubmission.findOne({
    _id: abstractId,
    owner: user._id,
  });

  if (!doc) {
    throw new HttpError(404, "Abstract not found");
  }

  assertUserCanModify(doc);

  const safe = sanitizeUserAbstractUpdates(updates);

  const merged = {
    ...doc.toObject(),
    ...safe,
  };

  const { keywords } = applyBusinessValidation(merged, {
    requireDecls: false,
  });

  safe.keywords = keywords;

  const parsed = parseCoAuthors(
    safe.coAuthorsRaw ?? merged.coAuthorsRaw ?? ""
  );

  safe.coAuthorsRaw = parsed.coAuthorsRaw;
  safe.coAuthors = parsed.coAuthors;

  let idsToRemove = [];

  if (
    removeAttachmentIds === "ALL" ||
    (Array.isArray(removeAttachmentIds) && removeAttachmentIds.includes("ALL"))
  ) {
    idsToRemove = (doc.attachments || []).map((a) => String(a._id));
  } else if (Array.isArray(removeAttachmentIds)) {
    idsToRemove = removeAttachmentIds.map(String);
  }

  const removeSet = new Set(idsToRemove);

  const attachmentsBefore = doc.attachments || [];

  const removedAttachments = attachmentsBefore.filter((a) =>
    removeSet.has(String(a._id))
  );

  const filesToDelete = removedAttachments
    .map((a) => a.storedName)
    .filter(Boolean);

  Object.assign(doc, safe);

  if (removeSet.size > 0) {
    doc.attachments = attachmentsBefore.filter(
      (a) => !removeSet.has(String(a._id))
    );
  }

  const newAttachments = (files || []).map((f) => ({
    originalName: f.originalname,
    storedName: f.filename,
    mimeType: f.mimetype,
    size: f.size,
  }));

  if (newAttachments.length > 0) {
    doc.attachments.push(...newAttachments);
  }

  doc.status = "submitted";

  await doc.save();

  await Promise.all(
    filesToDelete.map(async (storedName) => {
      try {
        const absPath = path.join(ABSTRACT_UPLOAD_DIR, storedName);
        await fs.unlink(absPath);
      } catch (e) {
        // ignore file delete errors
      }
    })
  );

  return doc;
}

async function addAttachments(user, id, files = []) {
  try {
    ensureAuthUser(user);
    assertAbstractSubmissionsOpen();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid abstract id.");
    }

    const doc = await AbstractSubmission.findOne({
      _id: id,
      owner: user._id,
    });

    if (!doc) {
      throw new HttpError(404, "Abstract not found");
    }

    const attachments = (files || []).map((f) => ({
      originalName: f.originalname,
      storedName: f.filename,
      mimeType: f.mimetype,
      size: f.size,
    }));

    doc.attachments.push(...attachments);

    await doc.save();

    return doc;
  } catch (err) {
    if (err instanceof HttpError) throw err;

    console.error("addAttachments failed:", err);
    throw new HttpError(500, "Failed to add attachments.");
  }
}

async function removeAttachment(user, id, attachmentId) {
  try {
    ensureAuthUser(user);
    assertAbstractSubmissionsOpen();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid abstract id.");
    }

    if (!mongoose.Types.ObjectId.isValid(attachmentId)) {
      throw new HttpError(400, "Invalid attachment id.");
    }

    const doc = await AbstractSubmission.findOne({
      _id: id,
      owner: user._id,
    });

    if (!doc) {
      throw new HttpError(404, "Abstract not found");
    }

    const before = doc.attachments.length;

    doc.attachments = doc.attachments.filter(
      (a) => String(a._id) !== String(attachmentId)
    );

    if (doc.attachments.length === before) {
      throw new HttpError(404, "Attachment not found");
    }

    await doc.save();

    return doc;
  } catch (err) {
    if (err instanceof HttpError) throw err;

    console.error("removeAttachment failed:", err);
    throw new HttpError(500, "Failed to remove attachment.");
  }
}

/* ---------------- ADMIN ---------------- */

const ADMIN_STATUS_ENUM = new Set([
  "submitted",
  "under-review",
  "approved",
  "rejected",
]);

function normalizeAdminStatus(v) {
  return String(v ?? "").trim().toLowerCase();
}

async function adminListAbstracts(filters = {}, { page = 1, limit = 25 } = {}) {
  try {
    const q = {};

    if (filters.ownerId) {
      if (!mongoose.Types.ObjectId.isValid(filters.ownerId)) {
        throw new HttpError(400, "Invalid ownerId");
      }

      q.owner = ownerId;
    }

    if (filters.status) {
      q.status = filters.status;
    }

    if (filters.search) {
      const r = new RegExp(filters.search, "i");

      q.$or = [
        { abstractTitle: r },
        { presentingAuthorName: r },
        { correspondingAuthorName: r },
        { correspondingAuthorEmail: r },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      AbstractSubmission.find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("owner", "email")
        .populate("presentingAuthorProfile", "firstName lastName email country"),

      AbstractSubmission.countDocuments(q),
    ]);

    return {
      items,
      total,
      page: Number(page),
      limit: Number(limit),
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;

    console.error("adminListAbstracts failed:", err);
    throw new HttpError(500, "Failed to fetch abstracts.");
  }
}

async function adminSaveAbstractAllInOne(
  abstractId,
  updates = {},
  removeAttachmentIds = [],
  files = []
) {
  if (!mongoose.Types.ObjectId.isValid(abstractId)) {
    throw new HttpError(400, "Invalid abstract id.");
  }

  const doc = await AbstractSubmission.findById(abstractId);

  if (!doc) {
    throw new HttpError(404, "Abstract not found");
  }

  const safe = sanitizeUserAbstractUpdates(updates);

  const merged = {
    ...doc.toObject(),
    ...safe,
  };

  const { keywords } = applyBusinessValidation(merged, {
    requireDecls: false,
  });

  safe.keywords = keywords;

  const parsed = parseCoAuthors(
    safe.coAuthorsRaw ?? merged.coAuthorsRaw ?? ""
  );

  safe.coAuthorsRaw = parsed.coAuthorsRaw;
  safe.coAuthors = parsed.coAuthors;

  let idsToRemove = [];

  if (
    removeAttachmentIds === "ALL" ||
    (Array.isArray(removeAttachmentIds) && removeAttachmentIds.includes("ALL"))
  ) {
    idsToRemove = (doc.attachments || []).map((a) => String(a._id));
  } else if (Array.isArray(removeAttachmentIds)) {
    idsToRemove = removeAttachmentIds.map(String);
  }

  const removeSet = new Set(idsToRemove);

  const attachmentsBefore = doc.attachments || [];

  const removedAttachments = attachmentsBefore.filter((a) =>
    removeSet.has(String(a._id))
  );

  const filesToDelete = removedAttachments
    .map((a) => a.storedName)
    .filter(Boolean);

  Object.assign(doc, safe);

  if (removeSet.size > 0) {
    doc.attachments = attachmentsBefore.filter(
      (a) => !removeSet.has(String(a._id))
    );
  }

  const newAttachments = (files || []).map((f) => ({
    originalName: f.originalname,
    storedName: f.filename,
    mimeType: f.mimetype,
    size: f.size,
  }));

  if (newAttachments.length > 0) {
    doc.attachments.push(...newAttachments);
  }

  doc.status = "submitted";

  await doc.save();

  await Promise.all(
    filesToDelete.map(async (storedName) => {
      try {
        const absPath = path.join(ABSTRACT_UPLOAD_DIR, storedName);
        await fs.unlink(absPath);
      } catch (e) {
        // ignore file delete errors
      }
    })
  );

  return doc;
}

async function adminUpdateAbstractStatus(abstractId, status) {
  if (!mongoose.Types.ObjectId.isValid(abstractId)) {
    throw new HttpError(400, "Invalid abstract id.");
  }

  const s = normalizeAdminStatus(status);

  if (!ADMIN_STATUS_ENUM.has(s)) {
    throw new HttpError(
      400,
      'Invalid status. Allowed: "submitted", "under-review", "approved", "rejected".'
    );
  }

  const updated = await AbstractSubmission.findByIdAndUpdate(
    abstractId,
    { status: s },
    { new: true, runValidators: true }
  );

  if (!updated) {
    throw new HttpError(404, "Abstract not found");
  }

  return updated;
}

async function adminUpdateAbstract(id, updates) {
  try {
    return await adminSaveAbstractAllInOne(id, updates, [], []);
  } catch (err) {
    if (err instanceof HttpError) throw err;

    console.error("adminUpdateAbstract failed:", err);
    throw new HttpError(500, "Failed to update abstract.");
  }
}

async function adminDeleteAbstract(id) {
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid abstract id.");
    }

    const doc = await AbstractSubmission.findById(id);

    if (!doc) {
      throw new HttpError(404, "Abstract not found");
    }

    await AbstractSubmission.deleteOne({ _id: id });

    return {
      ok: true,
      message: "Abstract deleted (admin)",
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;

    console.error("adminDeleteAbstract failed:", err);
    throw new HttpError(500, "Failed to delete abstract.");
  }
}

module.exports = {
  createAbstract,
  listMyAbstracts,
  getMyAbstractById,
  updateMyAbstract,
  addAttachments,
  removeAttachment,
  adminListAbstracts,
  adminUpdateAbstract,
  deleteMyAbstract,
  adminDeleteAbstract,
  saveMyAbstractAllInOne,
  adminSaveAbstractAllInOne,
  adminUpdateAbstractStatus,
};