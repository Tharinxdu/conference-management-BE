const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { HttpError } = require("./http-error");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function makeJti() {
  return crypto.randomBytes(16).toString("hex");
}

function buildGalaQrText(token) {
  // scanner reads this text; keep consistent & identifiable
  return `APSC2026.GALA.${token}`;
}

function parseGalaQrText(qrText) {
  if (!qrText) return null;
  const s = String(qrText).trim();

  // allow raw token OR prefixed format
  if (s.startsWith("APSC2026.GALA.")) return s.replace("APSC2026.GALA.", "");
  return s;
}

function createGalaQrJwtToken({ orderMongoId, orderId, ticketId, jti, issuedAt, expiresAt }) {
  const secret = mustEnv("QR_JWT_SECRET"); // reuse same secret or create a dedicated one if you want
  return jwt.sign(
    {
      typ: "GALA_TICKET",
      orderMongoId: String(orderMongoId),
      orderId,
      ticketId,
      jti,
      iat: Math.floor(new Date(issuedAt).getTime() / 1000),
      exp: expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : undefined,
    },
    secret,
    { algorithm: "HS256" }
  );
}

function verifyGalaQrJwtToken(token) {
  const secret = mustEnv("QR_JWT_SECRET");
  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (payload?.typ !== "GALA_TICKET") throw new Error("Invalid token type");
    return payload;
  } catch {
    throw new HttpError(401, "Invalid or expired QR");
  }
}

module.exports = {
  sha256,
  makeJti,
  buildGalaQrText,
  parseGalaQrText,
  createGalaQrJwtToken,
  verifyGalaQrJwtToken,
};