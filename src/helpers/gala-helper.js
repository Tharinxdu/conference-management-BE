const { HttpError } = require("../utils/http-error");

function requireFields(body, fields = []) {
  const missing = fields.filter((f) => !body?.[f]);
  if (missing.length) throw new HttpError(400, `Missing required fields: ${missing.join(", ")}`);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function generateCode(prefix = "GALA", len = 8) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < len; i++) id += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return `${prefix}-${id}`;
}

function parseTicketCount(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, "ticketCount must be a positive integer.");
  if (n > 50) throw new HttpError(400, "ticketCount is too large (max 50).");
  return n;
}

module.exports = { requireFields, normalizeEmail, generateCode, parseTicketCount };