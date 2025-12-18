const crypto = require("crypto");
const jwt = require("jsonwebtoken");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function makeJti() {
  return crypto.randomBytes(16).toString("hex"); // 32 chars
}

function getPrefix() {
  return process.env.QR_PREFIX || "APSC2026";
}

function buildQrText(token) {
  return `${getPrefix()}.${token}`;
}

function parseQrText(qrText) {
  const prefix = getPrefix() + ".";
  if (!qrText || typeof qrText !== "string" || !qrText.startsWith(prefix)) return null;
  return qrText.slice(prefix.length);
}

function createQrJwtToken({ registrationMongoId, registrationId, conferenceType, jti, issuedAt, expiresAt }) {
  const secret = mustEnv("QR_SIGNING_SECRET");

  // store iat/exp explicitly so token can be regenerated deterministically if needed
  const payload = {
    sub: String(registrationMongoId),
    rid: String(registrationId),
    ct: String(conferenceType || ""),
    jti,
    iat: Math.floor(new Date(issuedAt).getTime() / 1000),
    exp: expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : undefined,
  };

  // IMPORTANT: noTimestamp so library doesn't overwrite iat
  return jwt.sign(payload, secret, { algorithm: "HS256", noTimestamp: true });
}

function verifyQrJwtToken(token) {
  const secret = mustEnv("QR_SIGNING_SECRET");
  return jwt.verify(token, secret, { algorithms: ["HS256"] });
}

module.exports = {
  sha256,
  makeJti,
  buildQrText,
  parseQrText,
  createQrJwtToken,
  verifyQrJwtToken,
};
