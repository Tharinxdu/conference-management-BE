const RegistrationQr = require("../models/RegistrationQr");
const Registration = require("../models/Registration");
const { HttpError } = require("../utils/http-error");

const { sha256, parseQrText, verifyQrJwtToken } = require("../utils/qr/qr-utils");

/**
 * Any authenticated staff or admin user may operate the desk. Route-level
 * middleware (requireStaff) enforces the role; this only guards against a
 * missing/!malformed user object reaching the DB write.
 */
function ensureActor(actorUser) {
  const actorId = actorUser?._id || actorUser?.id;
  if (!actorId) throw new HttpError(401, "Unauthorized");
  return actorId;
}

function mapAttendee(reg) {
  return {
    registrationId: reg.registrationId,
    firstName: reg.firstName,
    lastName: reg.lastName,
    conferenceType: reg.conferenceType,
    email: reg.email,
    institution: reg.institution,
    country: reg.country,
  };
}

function mapQr(qrDoc) {
  return {
    status: qrDoc.status,
    checkInStatus: qrDoc.checkInStatus,
    checkedInAt: qrDoc.checkedInAt || null,
    checkedInBy: qrDoc.checkedInBy || null,
    checkedInByEmail: qrDoc.checkedInBy?.email || null,
  };
}

async function resolveQrAndRegistration(qrText) {
  if (!qrText) throw new HttpError(400, "qrText is required");

  // qrText can be a raw token OR a URL containing token
  const token = parseQrText(qrText);
  if (!token) throw new HttpError(400, "Invalid QR format");

  let payload;
  try {
    payload = verifyQrJwtToken(token);
  } catch {
    throw new HttpError(401, "Invalid or expired QR");
  }

  const tokenHash = sha256(token);

  const qrDoc = await RegistrationQr.findOne({ tokenHash }).populate("checkedInBy", "email");
  if (!qrDoc) throw new HttpError(404, "QR not found");

  // lifecycle checks
  if (qrDoc.status !== "ACTIVE") throw new HttpError(409, `QR is ${qrDoc.status}`);

  if (qrDoc.expiresAt && qrDoc.expiresAt <= new Date()) {
    // best-effort update so future scans show EXPIRED
    qrDoc.status = "EXPIRED";
    await qrDoc.save().catch(() => { });
    throw new HttpError(401, "QR expired");
  }

  const reg = await Registration.findById(qrDoc.registration);
  if (!reg) throw new HttpError(404, "Registration not found");

  if (reg.paymentStatus !== "PAID") {
    throw new HttpError(409, "Registration is not PAID");
  }

  // Optional safety check (only if your QR JWT includes registrationId)
  if (payload?.registrationId && payload.registrationId !== reg.registrationId) {
    throw new HttpError(409, "QR does not match this registration");
  }

  return { token, payload, tokenHash, qrDoc, reg };
}

/**
 * PREVIEW ONLY (no DB update):
 * - Staff/admin must be logged in
 * - Returns attendee + current check-in state
 */
async function previewCheckIn({ qrText, actorUser }) {
  ensureActor(actorUser);

  const { qrDoc, reg } = await resolveQrAndRegistration(qrText);

  return {
    ok: true,
    attendee: mapAttendee(reg),
    paymentStatus: reg.paymentStatus,
    qr: mapQr(qrDoc),
  };
}

/**
 * CONFIRM CHECK-IN (DB update):
 * - Idempotent: if already checked in, return "already checked in" response (no error)
 * - Atomic update prevents double check-in if two devices scan at same time
 */
async function confirmCheckIn({ qrText, actorUser }) {
  const actorId = ensureActor(actorUser);

  const { tokenHash, qrDoc, reg } = await resolveQrAndRegistration(qrText);

  // If already checked in, return idempotent success
  if (qrDoc.checkInStatus === "CHECKED_IN") {
    return {
      ok: true,
      message: "Already checked in",
      alreadyCheckedIn: true,
      attendee: mapAttendee(reg),
      checkedInAt: qrDoc.checkedInAt,
      checkedInByEmail: qrDoc.checkedInBy?.email || null,
    };
  }

  // Atomic update: only update if still NOT_CHECKED_IN + ACTIVE
  const updatedQr = await RegistrationQr.findOneAndUpdate(
    {
      _id: qrDoc._id,
      tokenHash,
      status: "ACTIVE",
      checkInStatus: "NOT_CHECKED_IN",
    },
    {
      $set: {
        checkInStatus: "CHECKED_IN",
        checkedInAt: new Date(),
        checkedInBy: actorId,
      },
    },
    { new: true }
  );

  // If this is null, someone else checked in between preview and confirm
  if (!updatedQr) {
    const fresh = await RegistrationQr.findOne({ tokenHash }).populate("checkedInBy", "email");
    return {
      ok: true,
      message: "Already checked in",
      alreadyCheckedIn: true,
      attendee: mapAttendee(reg),
      checkedInAt: fresh?.checkedInAt || null,
      checkedInByEmail: fresh?.checkedInBy?.email || null,
    };
  }

  return {
    ok: true,
    message: "Checked in",
    attendee: mapAttendee(reg),
    checkedInAt: updatedQr.checkedInAt,
  };
}

/**
 * Shared lookup for the "QR unreadable" fallback path.
 * Loads the QR record by registration ID and enforces its lifecycle.
 */
async function resolveByRegistrationId(registrationId) {
  if (!registrationId) throw new HttpError(400, "registrationId is required");

  const qrDoc = await RegistrationQr.findOne({ registrationId }).populate("checkedInBy", "email");
  if (!qrDoc) throw new HttpError(404, "QR record not found for this registrationId");

  if (qrDoc.status !== "ACTIVE") throw new HttpError(409, `QR is ${qrDoc.status}`);
  if (qrDoc.expiresAt && qrDoc.expiresAt <= new Date()) {
    qrDoc.status = "EXPIRED";
    await qrDoc.save().catch(() => { });
    throw new HttpError(401, "QR expired");
  }

  const reg = await Registration.findById(qrDoc.registration);
  if (!reg) throw new HttpError(404, "Registration not found");

  return { qrDoc, reg };
}

/** PREVIEW BY REGISTRATION ID (no DB update). */
async function previewByRegistrationId({ registrationId, actorUser }) {
  ensureActor(actorUser);

  const { qrDoc, reg } = await resolveByRegistrationId(registrationId);

  return {
    registrationId: reg.registrationId,
    attendee: mapAttendee(reg),
    paymentStatus: reg.paymentStatus,
    qr: mapQr(qrDoc),

    // Kept flat for backwards compatibility with existing clients.
    checkInStatus: qrDoc.checkInStatus,
    checkedInAt: qrDoc.checkedInAt,
  };
}

/**
 * CONFIRM CHECK-IN BY REGISTRATION ID:
 * - Idempotent: if already checked in, return "already checked in" (no error)
 * - Atomic update prevents double check-in if two devices act at the same time
 */
async function checkInByRegistrationId({ registrationId, actorUser }) {
  const actorId = ensureActor(actorUser);

  const { qrDoc, reg } = await resolveByRegistrationId(registrationId);

  if (reg.paymentStatus !== "PAID") throw new HttpError(409, "Registration is not PAID");

  if (qrDoc.checkInStatus === "CHECKED_IN") {
    return {
      ok: true,
      message: "Already checked in",
      alreadyCheckedIn: true,
      registrationId: reg.registrationId,
      attendee: mapAttendee(reg),
      checkedInAt: qrDoc.checkedInAt,
      checkedInByEmail: qrDoc.checkedInBy?.email || null,
    };
  }

  const updatedQr = await RegistrationQr.findOneAndUpdate(
    {
      _id: qrDoc._id,
      status: "ACTIVE",
      checkInStatus: "NOT_CHECKED_IN",
    },
    {
      $set: {
        checkInStatus: "CHECKED_IN",
        checkedInAt: new Date(),
        checkedInBy: actorId,
      },
    },
    { new: true }
  );

  // Lost the race against another device between read and write.
  if (!updatedQr) {
    const fresh = await RegistrationQr.findById(qrDoc._id).populate("checkedInBy", "email");
    return {
      ok: true,
      message: "Already checked in",
      alreadyCheckedIn: true,
      registrationId: reg.registrationId,
      attendee: mapAttendee(reg),
      checkedInAt: fresh?.checkedInAt || null,
      checkedInByEmail: fresh?.checkedInBy?.email || null,
    };
  }

  return {
    ok: true,
    message: "Checked in",
    registrationId: reg.registrationId,
    attendee: mapAttendee(reg),
    checkedInAt: updatedQr.checkedInAt,
  };
}

module.exports = {
  previewCheckIn,
  confirmCheckIn,
  previewByRegistrationId,
  checkInByRegistrationId,
};
