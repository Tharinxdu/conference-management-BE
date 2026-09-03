// src/services/exchange-rate-service.js
const ExchangeRate = require("../models/ExchangeRate.js");
const { HttpError } = require("../utils/http-error.js");

const PAIR = "USD_LKR";
const SOURCE_URL = "https://open.er-api.com/v6/latest/USD";

const FETCH_TIMEOUT_MS = 8000;
const MIN_TTL_MS = 30 * 60 * 1000; // never poll more often than this
const FALLBACK_TTL_MS = 6 * 60 * 60 * 1000; // if provider gives no next-update
const STALE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000; // refuse to price off a rate older than this

let memoryCache = null; // { rate, fetchedAt, nextUpdateAt }
let inFlight = null; // prevents a refresh stampede

function adopt(doc) {
  memoryCache = {
    rate: doc.rate,
    fetchedAt: doc.fetchedAt,
    nextUpdateAt: doc.nextUpdateAt,
  };
  return memoryCache;
}

async function fetchFromProvider() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let json;
  try {
    const res = await fetch(SOURCE_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`Provider responded ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  if (json?.result !== "success") {
    throw new Error(`Provider result: ${json?.result || "unknown"}`);
  }

  const rate = Number(json?.rates?.LKR);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("Provider returned no usable LKR rate.");
  }

  let nextUpdateAt = json?.time_next_update_unix
    ? new Date(json.time_next_update_unix * 1000)
    : new Date(Date.now() + FALLBACK_TTL_MS);

  // Provider updates can run late; don't turn that into a retry loop.
  if (nextUpdateAt.getTime() < Date.now() + MIN_TTL_MS) {
    nextUpdateAt = new Date(Date.now() + MIN_TTL_MS);
  }

  return { rate, nextUpdateAt };
}

async function refresh() {
  const stored = await ExchangeRate.findOne({ pair: PAIR });

  // Still fresh (possibly refreshed by another process) — no provider call.
  if (stored && stored.nextUpdateAt.getTime() > Date.now()) {
    return adopt(stored);
  }

  let fresh;
  try {
    fresh = await fetchFromProvider();
  } catch (err) {
    console.error("[fx] provider fetch failed:", err?.message || err);
    // Keep serving the last good rate. The staleness ceiling in
    // getUsdToLkrRate() stops this going on indefinitely.
    return stored ? adopt(stored) : null;
  }

  const saved = await ExchangeRate.findOneAndUpdate(
    { pair: PAIR },
    { pair: PAIR, rate: fresh.rate, fetchedAt: new Date(), nextUpdateAt: fresh.nextUpdateAt },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return adopt(saved);
}

/**
 * Current USD -> LKR rate. Throws rather than guessing.
 */
async function getUsdToLkrRate() {
  if (memoryCache && Date.now() < memoryCache.nextUpdateAt.getTime()) {
    return memoryCache;
  }

  if (!inFlight) {
    inFlight = refresh().finally(() => {
      inFlight = null;
    });
  }

  const result = await inFlight;

  if (!result) {
    throw new HttpError(
      503,
      "Exchange rate is temporarily unavailable. Please try again shortly or pay in USD."
    );
  }

  if (Date.now() - new Date(result.fetchedAt).getTime() > STALE_LIMIT_MS) {
    throw new HttpError(
      503,
      "Exchange rate is out of date. Please try again later or pay in USD."
    );
  }

  return result;
}

/**
 * Convert a USD fee to the LKR amount to charge.
 * Rounds up to whole rupees — cents aren't used in practice.
 */
async function convertUsdToLkr(usdAmount) {
  const usd = Number(usdAmount);
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new HttpError(400, "Invalid USD amount for conversion.");
  }

  const { rate, fetchedAt } = await getUsdToLkrRate();

  return {
    amount: Math.ceil(usd * rate),
    rate,
    fetchedAt,
  };
}

module.exports = { getUsdToLkrRate, convertUsdToLkr };