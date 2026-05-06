const mongoose = require("mongoose");

const GalaOrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true, index: true },

    // buyer
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },

    ticketCount: { type: Number, required: true, min: 1, max: 50 },

    currency: { type: String, required: true, default: "USD" },
    unitPrice: { type: Number, required: true, default: 40 },
    totalAmount: { type: Number, required: true }, // unitPrice * ticketCount

    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PENDING", "PAID", "FAILED"],
      default: "UNPAID",
      index: true,
    },
    paymentReference: { type: String, default: null },
    paymentProvider: { type: String, default: null },

    // OnePay
    onepayTransactionId: { type: String, default: null, unique: true, sparse: true, index: true },
    redirectUrl: { type: String, default: null },

    // audit
    lastCallback: { type: Object, default: null },
    paidAt: { type: Date, default: null },
    lastError: { type: String, default: null },

    // email control
    emailSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

GalaOrderSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model("GalaOrder", GalaOrderSchema);