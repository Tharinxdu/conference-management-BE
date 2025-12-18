const PresentingAuthorProfile = require("../models/PresentingAuthorProfile");
const { HttpError } = require("../utils/http-error");
const { requireFields } = require("../helpers/registration-helper"); // reuse your helper

function sanitizeProfileUpdates(updates = {}) {
  // Required fields NOT editable later (as per your requirement)
  const disallowed = new Set([
    "userId",
    "title",
    "firstName",
    "lastName",
    "email",
    "country",
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

function ensureAuthUser(user) {
  if (!user) throw new HttpError(401, "Not authenticated");
  if (!user._id) throw new HttpError(401, "Invalid auth user (missing _id)");
  if (!user.email) throw new HttpError(400, "Invalid auth user (missing email)");
}

async function getMyProfile(user) {
  try {
    ensureAuthUser(user);

    const profile = await PresentingAuthorProfile.findOne({ userId: user._id });
    // can be null -> frontend uses hasProfile flag
    return profile;
  } catch (err) {
    if (err instanceof HttpError) throw err;

    console.error("getMyProfile failed:", err);
    throw new HttpError(500, "Failed to fetch profile.");
  }
}

async function createMyProfile(user, payload) {
  try {
    ensureAuthUser(user);

    // Popup is mandatory -> enforce required fields
    requireFields(payload, ["title", "firstName", "lastName", "country"]);

    // Prevent duplicate profile creation
    const existing = await PresentingAuthorProfile.findOne({ userId: user._id });
    if (existing) throw new HttpError(409, "Profile already exists.");

    const profile = await PresentingAuthorProfile.create({
      userId: user._id,

      // required
      title: payload.title,
      firstName: payload.firstName,
      lastName: payload.lastName,
      country: payload.country,

      // email must be from auth user
      email: user.email,

      // optional
      affiliation: payload.affiliation || "",
      department: payload.department || "",
      city: payload.city || "",
      designation: payload.designation || "",
    });

    return profile;
  } catch (err) {
    // duplicate key error (unique userId) -> profile already exists
    if (err?.code === 11000) {
      throw new HttpError(409, "Profile already exists.");
    }

    if (err instanceof HttpError) throw err;

    // Mongoose validation errors -> 400
    if (err?.name === "ValidationError") {
      throw new HttpError(400, "Invalid profile data.", err?.errors);
    }

    console.error("createMyProfile failed:", err);
    throw new HttpError(500, "Failed to create profile.");
  }
}

async function updateMyProfile(user, updates) {
  try {
    ensureAuthUser(user);

    const profile = await PresentingAuthorProfile.findOne({ userId: user._id });
    if (!profile) throw new HttpError(404, "Profile not found. Create it first.");

    const safeUpdates = sanitizeProfileUpdates(updates);

    // If user sends nothing editable
    if (!Object.keys(safeUpdates).length) {
      throw new HttpError(400, "No editable fields provided.");
    }

    const updated = await PresentingAuthorProfile.findOneAndUpdate(
      { userId: user._id },
      safeUpdates,
      { new: true, runValidators: true }
    );

    return updated;
  } catch (err) {
    if (err instanceof HttpError) throw err;

    if (err?.name === "ValidationError") {
      throw new HttpError(400, "Invalid update data.", err?.errors);
    }

    console.error("updateMyProfile failed:", err);
    throw new HttpError(500, "Failed to update profile.");
  }
}

module.exports = {
  getMyProfile,
  createMyProfile,
  updateMyProfile,
};
