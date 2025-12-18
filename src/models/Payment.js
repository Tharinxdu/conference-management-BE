const mongoose = require("mongoose");

const PaymentSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["ONEPAY"],
      required: true,
      default: "ONEPAY",
      index: true,
    },

    registrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      required: true,
      index: true,
    },

    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    onepayTransactionId: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      index: true,
    },

    currency: { type: String, required: true, default: "USD" },
    amount: { type: Number, required: true },

    redirectUrl: { type: String, default: null },

    status: {
      type: String,
      enum: ["INITIATED", "PENDING", "PAID", "FAILED", "CANCELED"],
      default: "INITIATED",
      index: true,
    },

    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },

    lastCallback: { type: Object, default: null },
    paidAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PaymentSchema.index({ registrationId: 1, createdAt: -1 });
PaymentSchema.index({ registrationId: 1, status: 1 });

module.exports = mongoose.model("Payment", PaymentSchema);
