const GalaOrder = require("../models/GalaOrder");
const { HttpError } = require("../utils/http-error");
const { requireFields, normalizeEmail, generateCode, parseTicketCount } = require("../helpers/gala-helper");

const UNIT_PRICE_USD = 40;

async function createGalaOrder(payload) {
  requireFields(payload, ["name", "email", "ticketCount"]);

  const name = String(payload.name || "").trim();
  const email = normalizeEmail(payload.email);
  const ticketCount = parseTicketCount(payload.ticketCount);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpError(400, "Please enter a valid email address.");
  }

  // const totalAmount = UNIT_PRICE_USD * ticketCount;
  const totalAmount = 1; 

  const order = await GalaOrder.create({
    orderId: generateCode("GALA", 8),
    name,
    email,
    ticketCount,
    currency: "USD",
    unitPrice: UNIT_PRICE_USD,
    totalAmount,
    paymentStatus: "UNPAID",
  });

  return order;
}

module.exports = { createGalaOrder };