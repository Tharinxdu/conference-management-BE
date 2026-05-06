const QRCode = require("qrcode");
const GalaTicket = require("../models/GalaTicket");
const { HttpError } = require("../utils/http-error");
const { sha256, makeJti, buildGalaQrText, createGalaQrJwtToken } = require("../utils/gala-qr-utils");
const { generateCode } = require("../helpers/gala-helper");

function getExpiryDate() {
  const days = Number(process.env.GALA_QR_EXPIRES_IN_DAYS || 60);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

async function issueTicketsForOrder(order) {
  if (!order?._id) throw new HttpError(500, "Order missing.");
  if (order.paymentStatus !== "PAID") throw new HttpError(409, "Order is not PAID. Cannot issue tickets.");

  const expiresAt = getExpiryDate();
  const issuedAt = new Date();

  // If tickets already exist for this order, reuse them (idempotent)
  const existing = await GalaTicket.find({ order: order._id }).sort({ createdAt: 1 });
  if (existing.length) {
    // rebuild tokens (we don't store raw token)
    const out = [];
    for (const t of existing) {
      const token = createGalaQrJwtToken({
        orderMongoId: order._id,
        orderId: order.orderId,
        ticketId: t.ticketId,
        jti: t.jti,
        issuedAt: t.issuedAt,
        expiresAt: t.expiresAt,
      });

      const qrText = buildGalaQrText(token);
      const png = await QRCode.toBuffer(qrText, {
        type: "png",
        errorCorrectionLevel: "M",
        margin: 2,
        scale: 6,
      });

      out.push({ ticketDoc: t, ticketId: t.ticketId, qrText, pngBuffer: png, reused: true });
    }
    return out;
  }

  // Create new tickets
  const results = [];
  for (let i = 0; i < order.ticketCount; i++) {
    const ticketId = generateCode("DINNER", 8); // e.g. DINNER-AB12CD34
    const jti = makeJti();

    const token = createGalaQrJwtToken({
      orderMongoId: order._id,
      orderId: order.orderId,
      ticketId,
      jti,
      issuedAt,
      expiresAt,
    });

    const tokenHash = sha256(token);
    const qrText = buildGalaQrText(token);

    const ticketDoc = await GalaTicket.create({
      order: order._id,
      ticketId,
      jti,
      tokenHash,
      status: "ACTIVE",
      issuedAt,
      expiresAt,
      redeemStatus: "NOT_REDEEMED",
    });

    const png = await QRCode.toBuffer(qrText, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 6,
    });

    results.push({ ticketDoc, ticketId, qrText, pngBuffer: png, reused: false });
  }

  return results;
}

module.exports = { issueTicketsForOrder };