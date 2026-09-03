const GalaOrder = require("../models/GalaOrder");
const { HttpError } = require("../utils/http-error");
const { requireFields, normalizeEmail, generateCode, parseTicketCount } = require("../helpers/gala-helper");
const { isValidCountry } = require("../helpers/countries");

const UNIT_PRICE_USD = 40;

async function createGalaOrder(payload) {
  requireFields(payload, ["name", "email", "country", "ticketCount"]);

  const name = String(payload.name || "").trim();
  const email = normalizeEmail(payload.email);
  const country = String(payload.country || "").trim();
  const ticketCount = parseTicketCount(payload.ticketCount);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpError(400, "Please enter a valid email address.");
  }

  if (!isValidCountry(country)) {
    throw new HttpError(400, `Unknown country: ${country}`);
  }

  // Price is always USD. The charged currency is decided at payment initiation
  // from the country, so nothing here changes for local buyers.
  const totalAmount = UNIT_PRICE_USD * ticketCount;

  const order = await GalaOrder.create({
    orderId: generateCode("GALA", 8),
    name,
    email,
    country,
    ticketCount,
    currency: "USD",
    unitPrice: UNIT_PRICE_USD,
    totalAmount,
    paymentStatus: "UNPAID",
  });

  return order;
}

module.exports = { createGalaOrder };