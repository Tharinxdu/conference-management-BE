// src/services/gala-ticket-service.js
const QRCode = require("qrcode");
const { createCanvas, loadImage } = require("canvas");

const GalaTicket = require("../models/GalaTicket");
const { HttpError } = require("../utils/http-error");
const {
  sha256,
  makeJti,
  buildGalaQrText,
  createGalaQrJwtToken,
} = require("../utils/gala-qr-utils");
const { generateCode } = require("../helpers/gala-helper");

function getExpiryDate() {
  const days = Number(process.env.GALA_QR_EXPIRES_IN_DAYS || 60);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Renders a PNG that has:
 *  - Ticket ID at the top
 *  - QR code below
 */
async function renderTicketQrPng({ ticketId, qrText }) {
  // 1) Create QR buffer first (pure QR)
  const qrBuffer = await QRCode.toBuffer(qrText, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    scale: 8,
  });

  // 2) Load QR into canvas
  const qrImg = await loadImage(qrBuffer);

  // Layout sizing
  const padding = 22;
  const headerH = 74;
  const footerH = 34;

  // Keep QR square
  const qrSize = Math.max(qrImg.width, qrImg.height);

  const width = qrSize + padding * 2;
  const height = headerH + qrSize + footerH + padding;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, width, height);

  // Card surface
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  roundRect(ctx, 12, 12, width - 24, height - 24, 18);
  ctx.fill();

  // Header strip
  ctx.fillStyle = "rgba(34,211,238,0.14)";
  roundRect(ctx, 18, 18, width - 36, headerH, 16);
  ctx.fill();

  // Title small
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = "600 14px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("APSC 2026 • Gala Dinner Ticket", 34, 18 + 22);

  // Ticket ID big
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 22px Arial";
  ctx.fillText(ticketId, 34, 18 + 50);

  // QR image centered
  const qrX = Math.floor((width - qrSize) / 2);
  const qrY = 18 + headerH + 10;

  // White QR background for scan reliability
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, qrX - 8, qrY - 8, qrSize + 16, qrSize + 16, 14);
  ctx.fill();

  ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);

  // Footer hint
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "600 12px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Present this QR at the registration desk to collect your coupon", width / 2, height - 28);

  return canvas.toBuffer("image/png");
}

/** helper: rounded rectangle */
function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

async function issueTicketsForOrder(order) {
  if (!order?._id) throw new HttpError(500, "Order missing.");
  if (order.paymentStatus !== "PAID") {
    throw new HttpError(409, "Order is not PAID. Cannot issue tickets.");
  }

  const expiresAt = getExpiryDate();
  const issuedAt = new Date();

  // If tickets already exist for this order, reuse them (idempotent)
  const existing = await GalaTicket.find({ order: order._id }).sort({ createdAt: 1 });
  if (existing.length) {
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

      // ✅ Updated: render with ticketId on top
      const png = await renderTicketQrPng({ ticketId: t.ticketId, qrText });

      out.push({
        ticketDoc: t,
        ticketId: t.ticketId,
        qrText,
        pngBuffer: png,
        reused: true,
      });
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

    // ✅ Updated: render with ticketId on top
    const png = await renderTicketQrPng({ ticketId, qrText });

    results.push({
      ticketDoc,
      ticketId,
      qrText,
      pngBuffer: png,
      reused: false,
    });
  }

  return results;
}

module.exports = { issueTicketsForOrder };