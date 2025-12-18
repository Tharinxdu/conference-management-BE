const mongoose = require("mongoose");
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
} = require("../helpers/abstract-helper");

function ensureAuthUser(user) {
  if (!user?._id) throw new HttpError(401, "Not authenticated");
}

async function getProfileIdForUser(userId) {
  const profile = await PresentingAuthorProfile.findOne({ userId }).select("_id firstName lastName email");
  if (!profile) throw new HttpError(409, "Profile is required before submitting abstracts.");
  return profile;
}

function applyBusinessValidation(payload, { requireDecls }) {
  // required base fields
  const required = [
    "presentingAuthorName",
    "correspondingAuthorName",
    "abstractTitle",
    "abstractText",
  ];
  for (const f of required) {
    if (!payload?.[f]) throw new HttpError(400, `Missing required field: ${f}`);
  }

  // arrays must have >= 1
  ensureAtLeastOne(payload.preferredPresentationTypes, "Select at least one presentation type.");
  ensureAtLeastOne(payload.scientificCategories, "Select at least one scientific category.");

  // OTHER requires text
  if (payload.scientificCategories?.includes("OTHER") && !payload.otherCategoryText) {
    throw new HttpError(400, "Other category text is required when selecting OTHER.");
  }

  // 300 words max
  if (wordCount(payload.abstractText) > 300) {
    throw new HttpError(400, "Abstract text must be 300 words or less.");
  }

  // keywords 1..5
  const keywords = normalizeKeywords(payload.keywords);
  if (keywords.length < 1) throw new HttpError(400, "Keywords are required.");
  if (keywords.length > 5) throw new HttpError(400, "Maximum 5 keywords allowed.");

  // declarations required only on create/submit
  if (requireDecls) validateDeclarations(payload.declarations);

  return { keywords };
}

async function createAbstract(user, payload, files = []) {
  try {
    ensureAuthUser(user);

    const profile = await getProfileIdForUser(user._id);

    const { keywords } = applyBusinessValidation(payload, { requireDecls: true });
    const { coAuthorsRaw, coAuthors } = parseCoAuthors(payload.coAuthorsRaw || "");

    const attachments = (files || []).map((f) => ({
      originalName: f.originalname,
      storedName: f.filename,
      mimeType: f.mimetype,
      size: f.size,
    }));

    const doc = await AbstractSubmission.create({
      owner: user._id,
      presentingAuthorProfile: profile._id,

      presentingAuthorName: payload.presentingAuthorName,
      correspondingAuthorName: payload.correspondingAuthorName,
      correspondingAuthorEmail: payload.correspondingAuthorEmail || "",

      abstractTitle: payload.abstractTitle,
      preferredPresentationTypes: payload.preferredPresentationTypes,
      scientificCategories: payload.scientificCategories,
      otherCategoryText: payload.otherCategoryText || "",

      abstractText: payload.abstractText,
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

      // ✅ add these fields in schema (recommended)
      submittedAt: new Date(),
      submissionEmailSentAt: null,
    });

    // ✅ Send "submitted successfully" email (no abstract content)
    if (!doc.submissionEmailSentAt) {
      // Prefer profile first name if available, else fallback to name on payload
      const firstName =
        (profile && profile.firstName) ||
        String(payload.presentingAuthorName || "Author").split(" ")[0];

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
    return await AbstractSubmission.find({ owner: user._id }).sort({ createdAt: -1 });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("listMyAbstracts failed:", err);
    throw new HttpError(500, "Failed to fetch abstracts.");
  }
}

async function getMyAbstractById(user, id) {
  try {
    ensureAuthUser(user);
    if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid abstract id.");

    const doc = await AbstractSubmission.findOne({ _id: id, owner: user._id });
    if (!doc) throw new HttpError(404, "Abstract not found");
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
    if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid abstract id.");

    const current = await AbstractSubmission.findOne({ _id: id, owner: user._id });
    if (!current) throw new HttpError(404, "Abstract not found");

    // declarations are NOT required on edit
    const safe = sanitizeUserAbstractUpdates(updates);

    // if user changes content-related fields, re-validate
    const merged = {
      ...current.toObject(),
      ...safe,
    };

    const { keywords } = applyBusinessValidation(merged, { requireDecls: false });
    safe.keywords = keywords;

    const parsed = parseCoAuthors(safe.coAuthorsRaw ?? merged.coAuthorsRaw ?? "");
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

async function addAttachments(user, id, files = []) {
  try {
    ensureAuthUser(user);
    if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid abstract id.");

    const doc = await AbstractSubmission.findOne({ _id: id, owner: user._id });
    if (!doc) throw new HttpError(404, "Abstract not found");

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
    if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid abstract id.");
    if (!mongoose.Types.ObjectId.isValid(attachmentId)) throw new HttpError(400, "Invalid attachment id.");

    const doc = await AbstractSubmission.findOne({ _id: id, owner: user._id });
    if (!doc) throw new HttpError(404, "Abstract not found");

    const before = doc.attachments.length;
    doc.attachments = doc.attachments.filter((a) => String(a._id) !== String(attachmentId));
    if (doc.attachments.length === before) throw new HttpError(404, "Attachment not found");

    await doc.save();
    return doc;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("removeAttachment failed:", err);
    throw new HttpError(500, "Failed to remove attachment.");
  }
}

/* ---------------- ADMIN ---------------- */

async function adminListAbstracts(filters = {}, { page = 1, limit = 25 } = {}) {
  try {
    const q = {};

    if (filters.ownerId) {
      if (!mongoose.Types.ObjectId.isValid(filters.ownerId)) throw new HttpError(400, "Invalid ownerId");
      q.owner = filters.ownerId;
    }
    if (filters.status) q.status = filters.status;

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

    return { items, total, page: Number(page), limit: Number(limit) };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("adminListAbstracts failed:", err);
    throw new HttpError(500, "Failed to fetch abstracts.");
  }
}

async function adminUpdateAbstract(id, updates) {
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid abstract id.");

    const current = await AbstractSubmission.findById(id);
    if (!current) throw new HttpError(404, "Abstract not found");

    // admin can edit everything (including status), but we still validate core rules
    const merged = { ...current.toObject(), ...updates };

    // declarations not required for admin edits
    const { keywords } = applyBusinessValidation(merged, { requireDecls: false });
    updates.keywords = normalizeKeywords(updates.keywords ?? merged.keywords);

    if (updates.coAuthorsRaw !== undefined) {
      const parsed = parseCoAuthors(updates.coAuthorsRaw);
      updates.coAuthorsRaw = parsed.coAuthorsRaw;
      updates.coAuthors = parsed.coAuthors;
    }

    // validate arrays
    ensureAtLeastOne(merged.preferredPresentationTypes, "Select at least one presentation type.");
    ensureAtLeastOne(merged.scientificCategories, "Select at least one scientific category.");

    if (merged.scientificCategories?.includes("OTHER") && !merged.otherCategoryText) {
      throw new HttpError(400, "Other category text is required when selecting OTHER.");
    }

    if (wordCount(merged.abstractText) > 300) {
      throw new HttpError(400, "Abstract text must be 300 words or less.");
    }

    if (updates.keywords.length > 5) throw new HttpError(400, "Maximum 5 keywords allowed.");

    const updated = await AbstractSubmission.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    return updated;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("adminUpdateAbstract failed:", err);
    throw new HttpError(500, "Failed to update abstract.");
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
};
