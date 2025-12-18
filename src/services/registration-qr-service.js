const Registration = require("../models/Registration");
const RegistrationQr = require("../models/RegistrationQr");
const { HttpError } = require("../utils/http-error");

const {
  sha256,
  makeJti,
  buildQrText,
  createQrJwtToken,
} = require("../utils/qr/qr-utils");

function getExpiryDate() {
  const days = Number(process.env.QR_TOKEN_EXPIRES_IN_DAYS || 30);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Issue QR ONLY when registration is PAID.
 * Idempotent:
 * - if ACTIVE qr already exists and not expired -> returns it
 * - if missing/expired/revoked -> creates a new qr and updates registration.qr
 */
async function issueQrForRegistration(registrationMongoId) {
  const reg = await Registration.findById(registrationMongoId);
  if (!reg) throw new HttpError(404, "Registration not found");

  if (reg.paymentStatus !== "PAID") {
    throw new HttpError(409, "Cannot issue QR until payment is PAID.");
  }

  // If qr already linked, reuse if valid
  if (reg.qr) {
    const existing = await RegistrationQr.findById(reg.qr);
    if (existing) {
      const expired = existing.expiresAt && existing.expiresAt <= new Date();
      if (!expired && existing.status === "ACTIVE") {
        // Recreate token (deterministic) to build QR text again (without storing raw token)
        const token = createQrJwtToken({
          registrationMongoId: reg._id,
          registrationId: reg.registrationId,
          conferenceType: reg.conferenceType,
          jti: existing.jti,
          issuedAt: existing.issuedAt,
          expiresAt: existing.expiresAt,
        });

        return {
          qrDoc: existing,
          token,
          qrText: buildQrText(token),
          reused: true,
        };
      }
    }
  }

  // Create new QR record
  const issuedAt = new Date();
  const expiresAt = getExpiryDate();
  const jti = makeJti();

  const token = createQrJwtToken({
    registrationMongoId: reg._id,
    registrationId: reg.registrationId,
    conferenceType: reg.conferenceType,
    jti,
    issuedAt,
    expiresAt,
  });

  const tokenHash = sha256(token);

  // Ensure old one (if exists) is revoked
  if (reg.qr) {
    await RegistrationQr.updateOne({ _id: reg.qr }, { $set: { status: "REVOKED" } }).catch(() => {});
  }

  const qrDoc = await RegistrationQr.create({
    registration: reg._id,
    registrationId: reg.registrationId,
    jti,
    tokenHash,
    status: "ACTIVE",
    issuedAt,
    expiresAt,
    checkInStatus: "NOT_CHECKED_IN",
    emailSentAt: null,
  });

  reg.qr = qrDoc._id;
  await reg.save();

  return {
    qrDoc,
    token,
    qrText: buildQrText(token),
    reused: false,
  };
}

module.exports = { issueQrForRegistration };
