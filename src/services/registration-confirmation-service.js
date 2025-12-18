const mongoose = require("mongoose");
const QRCode = require("qrcode");

const Registration = require("../models/Registration.js");
const RegistrationQr = require("../models/RegistrationQr.js");
const { HttpError } = require("../utils/http-error.js");

const EmailService = require("./email-service.js");
const { issueQrForRegistration } = require("./registration-qr-service.js");

/**
 * Finalize registration after payment success:
 * - registration must be PAID
 * - issue/reuse QR (JWT-based) via issueQrForRegistration()
 * - email QR only once (RegistrationQr.emailSentAt)
 *
 * Safe to call multiple times (idempotent by design).
 */
async function finalizeRegistrationAfterPayment({
  registrationMongoId,
  paymentReference,
  paymentProvider = "ONEPAY",
}) {
  if (!mongoose.Types.ObjectId.isValid(registrationMongoId)) {
    throw new HttpError(400, "Invalid registration id.");
  }

  const reg = await Registration.findById(registrationMongoId);
  if (!reg) throw new HttpError(404, "Registration not found.");

  if (reg.paymentStatus !== "PAID") {
    throw new HttpError(409, "Registration is not PAID. Cannot issue QR.");
  }

  // Ensure provider/reference set (useful for audits/refunds later)
  if (paymentProvider && !reg.paymentProvider) reg.paymentProvider = paymentProvider;
  if (paymentReference && !reg.paymentReference) reg.paymentReference = paymentReference;
  await reg.save().catch(() => {});

  // ✅ Issue/reuse JWT-based QR
  const { qrDoc, qrText, reused } = await issueQrForRegistration(reg._id);

  // Create PNG buffer (encode QR TEXT, not URL)
  // This way the scanner reads a string like "APSC2026.<JWT>"
  const qrPngBuffer = await QRCode.toBuffer(qrText, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    scale: 6,
  });

  // Send email ONCE
  let emailSent = false;

  // Always re-fetch latest, since issueQrForRegistration may have just created it
  const freshQr = await RegistrationQr.findById(qrDoc._id);
  if (!freshQr) throw new HttpError(500, "QR record missing after issuing.");

  if (!freshQr.emailSentAt) {
    await EmailService.sendRegistrationQrEmail({
      to: reg.email,
      firstName: reg.firstName || "",
      registrationId: reg.registrationId,
      conferenceType: reg.conferenceType || "",
      qrPngBuffer,
    });

    freshQr.emailSentAt = new Date();
    await freshQr.save();
    emailSent = true;
  }

  return {
    ok: true,
    registrationMongoId: reg._id.toString(),
    qrId: freshQr._id.toString(),
    reused,
    emailSent,
  };
}

module.exports = { finalizeRegistrationAfterPayment };
