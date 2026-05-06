const mongoose = require("mongoose");

const GalaTicketSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GalaOrder",
      required: true,
      index: true,
    },

    ticketId: { type: String, required: true, unique: true, index: true },

    // traceability
    jti: { type: String, required: true, unique: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },

    status: {
      type: String,
      enum: ["ACTIVE", "REVOKED", "EXPIRED"],
      default: "ACTIVE",
      index: true,
    },

    issuedAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, default: null, index: true },

    redeemStatus: {
      type: String,
      enum: ["NOT_REDEEMED", "REDEEMED"],
      default: "NOT_REDEEMED",
      index: true,
    },
    redeemedAt: { type: Date, default: null },
    redeemedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

GalaTicketSchema.index({ order: 1, createdAt: 1 });

module.exports = mongoose.model("GalaTicket", GalaTicketSchema);