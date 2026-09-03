// src/models/ExchangeRate.js
const mongoose = require("mongoose");

/**
 * Last-known-good FX rate, one document per pair.
 *
 * Persisted (not just held in process memory) so that if the provider is
 * unreachable after a restart, LKR checkout can still price off the last
 * good rate instead of failing outright.
 */
const exchangeRateSchema = new mongoose.Schema(
  {
    pair: { type: String, required: true, unique: true, index: true }, // "USD_LKR"
    rate: { type: Number, required: true, min: 0 },
    fetchedAt: { type: Date, required: true },
    nextUpdateAt: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ExchangeRate", exchangeRateSchema);