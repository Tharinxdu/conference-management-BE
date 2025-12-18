const mongoose = require("mongoose");

const RegistrationSchema = new mongoose.Schema(
  {
    registrationId: { type: String, required: true, unique: true },

    // Personal info
    title: String,
    firstName: String,
    lastName: String,
    designation: String,
    institution: String,
    country: String,

    // Pricing info
    incomeGroup: String,
    participantCategory: String,
    conferenceType: String,
    feeAmount: Number,
    feePeriod: String,
    feeBreakdown: Object,

    // Contact
    email: String,
    mobile: String,

    // Consent
    consentDataUse: Boolean,
    consentTerms: Boolean,

    // Payment
    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PENDING", "PAID", "FAILED"],
      default: "UNPAID",
    },
    paymentReference: { type: String, default: null },
    paymentProvider: { type: String, default: null },

    qr: { type: mongoose.Schema.Types.ObjectId, ref: "RegistrationQr", default: null },

  },
  { timestamps: true }
);

module.exports = mongoose.model("Registration", RegistrationSchema);
