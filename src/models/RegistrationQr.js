const mongoose = require("mongoose");

const RegistrationQrSchema = new mongoose.Schema(
  {
    registration: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      required: true,
      index: true,
      unique: true,
    },

    registrationId: { type: String, required: true, index: true },

    // determinism + traceability
    jti: { type: String, required: true, unique: true, index: true },

    // Store ONLY a hash of the QR token (never raw token)
    tokenHash: { type: String, required: true, unique: true, index: true },

    status: {
      type: String,
      enum: ["ACTIVE", "REVOKED", "EXPIRED"],
      default: "ACTIVE",
      index: true,
    },
    issuedAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, default: null, index: true },

    checkInStatus: {
      type: String,
      enum: ["NOT_CHECKED_IN", "CHECKED_IN"],
      default: "NOT_CHECKED_IN",
      index: true,
    },
    checkedInAt: { type: Date, default: null },
    checkedInBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    emailSentAt: { type: Date, default: null },

  },
  { timestamps: true }
);

module.exports = mongoose.model("RegistrationQr", RegistrationQrSchema);
