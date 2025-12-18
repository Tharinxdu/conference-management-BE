const mongoose = require("mongoose");
const RegistrationQr = require("../models/RegistrationQr");
const Registration = require("../models/Registration");
const { HttpError } = require("../utils/http-error");

const { sha256, parseQrText, verifyQrJwtToken } = require("../utils/qr/qr-utils");

function ensureAdmin(adminUser) {
  const adminId = adminUser?._id || adminUser?.id;
  if (!adminId) throw new HttpError(401, "Unauthorized");
  return adminId;
}


function mapAttendee(reg) {
  return {
    registrationId: reg.registrationId,
    firstName: reg.firstName,
    lastName: reg.lastName,
    conferenceType: reg.conferenceType,
    email: reg.email,
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

  const qrDoc = await RegistrationQr.findOne({ tokenHash });
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
 * - Admin must be logged in
 * - Returns attendee + current check-in state
 */
async function previewCheckIn({ qrText, adminUser }) {
  ensureAdmin(adminUser);

  const { qrDoc, reg } = await resolveQrAndRegistration(qrText);

  return {
    ok: true,
    attendee: mapAttendee(reg),
    qr: {
      status: qrDoc.status,
      checkInStatus: qrDoc.checkInStatus,
      checkedInAt: qrDoc.checkedInAt,
      checkedInBy: qrDoc.checkedInBy,
    },
  };
}

/**
 * CONFIRM CHECK-IN (DB update):
 * - Idempotent: if already checked in, return "already checked in" response (no error)
 * - Atomic update prevents double check-in if two devices scan at same time
 */
async function confirmCheckIn({ qrText, adminUser }) {
  const adminId = ensureAdmin(adminUser);

  const { token, tokenHash, qrDoc, reg } = await resolveQrAndRegistration(qrText);

  // If already checked in, return idempotent success
  if (qrDoc.checkInStatus === "CHECKED_IN") {
    return {
      ok: true,
      message: "Already checked in",
      alreadyCheckedIn: true,
      attendee: mapAttendee(reg),
      checkedInAt: qrDoc.checkedInAt,
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
        checkedInBy: adminUser?._id || adminUser?.id,
      },
    },
    { new: true }
  );

  // If this is null, someone else checked in between preview and confirm
  if (!updatedQr) {
    const fresh = await RegistrationQr.findOne({ tokenHash });
    return {
      ok: true,
      message: "Already checked in",
      alreadyCheckedIn: true,
      attendee: mapAttendee(reg),
      checkedInAt: fresh?.checkedInAt || null,
    };
  }

  return {
    ok: true,
    message: "Checked in",
    attendee: mapAttendee(reg),
    checkedInAt: updatedQr.checkedInAt,
  };
}

/** PREVIEW BY REGISTRATION ID ONLY (no DB update):
 * - Admin must be logged in
 * - Returns attendee + current check-in state
 */
async function previewByRegistrationId({ registrationId, adminUser }) {
  ensureAdmin(adminUser);
  if (!registrationId) throw new HttpError(400, "registrationId is required");

  const qrDoc = await RegistrationQr.findOne({ registrationId });
  if (!qrDoc) throw new HttpError(404, "QR record not found for this registrationId");

  if (qrDoc.status !== "ACTIVE") throw new HttpError(409, `QR is ${qrDoc.status}`);
  if (qrDoc.expiresAt && qrDoc.expiresAt <= new Date()) {
    qrDoc.status = "EXPIRED";
    await qrDoc.save();
    throw new HttpError(401, "QR expired");
  }

  const reg = await Registration.findById(qrDoc.registration);
  if (!reg) throw new HttpError(404, "Registration not found");

  return {
    registrationId: reg.registrationId,
    attendee: {
      firstName: reg.firstName,
      lastName: reg.lastName,
      conferenceType: reg.conferenceType,
    },
    paymentStatus: reg.paymentStatus,
    checkInStatus: qrDoc.checkInStatus,
    checkedInAt: qrDoc.checkedInAt,
  };
}

/** CONFIRM CHECK-IN BY REGISTRATION ID:
  * - Idempotent: if already checked in, return "already checked in" response (no error)
  * - Atomic update prevents double check-in if two devices scan at same time
  */
async function checkInByRegistrationId({ registrationId, adminUser }) {
  ensureAdmin(adminUser);
  if (!registrationId) throw new HttpError(400, "registrationId is required");

  const qrDoc = await RegistrationQr.findOne({ registrationId });
  if (!qrDoc) throw new HttpError(404, "QR record not found for this registrationId");

  if (qrDoc.status !== "ACTIVE") throw new HttpError(409, `QR is ${qrDoc.status}`);
  if (qrDoc.expiresAt && qrDoc.expiresAt <= new Date()) {
    qrDoc.status = "EXPIRED";
    await qrDoc.save();
    throw new HttpError(401, "QR expired");
  }

  const reg = await Registration.findById(qrDoc.registration);
  if (!reg) throw new HttpError(404, "Registration not found");
  if (reg.paymentStatus !== "PAID") throw new HttpError(409, "Registration is not PAID");

  if (qrDoc.checkInStatus === "CHECKED_IN") {
    return {
      ok: true,
      message: "Already checked in",
      alreadyCheckedIn: true,
      attendee: mapAttendee(reg),
      checkedInAt: qrDoc.checkedInAt,
    };
  }

  qrDoc.checkInStatus = "CHECKED_IN";
  qrDoc.checkedInAt = new Date();
  qrDoc.checkedInBy = adminUser._id || adminUser.id;
  await qrDoc.save();

  return {
    message: "Checked in",
    registrationId: reg.registrationId,
    attendee: {
      firstName: reg.firstName,
      lastName: reg.lastName,
      conferenceType: reg.conferenceType,
    },
    checkedInAt: qrDoc.checkedInAt,
  };
}


module.exports = {
  previewCheckIn,
  confirmCheckIn,
  previewByRegistrationId,
  checkInByRegistrationId,
};
