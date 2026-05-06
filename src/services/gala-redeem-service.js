const mongoose = require("mongoose");
const GalaTicket = require("../models/GalaTicket");
const GalaOrder = require("../models/GalaOrder");
const User = require("../models/User");
const { HttpError } = require("../utils/http-error");

const { sha256, parseGalaQrText, verifyGalaQrJwtToken } = require("../utils/gala-qr-utils");

function ensureStaff(staffUser) {
  const id = staffUser?._id || staffUser?.id;
  if (!id) throw new HttpError(401, "Unauthorized");
  if (!staffUser.isStaff && !staffUser.isAdmin) throw new HttpError(403, "Staff access required");
  return String(id);
}

async function getRedeemerSafe(redeemedBy) {
  if (!redeemedBy) return null;
  const u = await User.findById(redeemedBy).select("email isAdmin isStaff").lean().catch(() => null);
  if (!u) return { _id: String(redeemedBy), email: null };
  return { _id: String(u._id), email: u.email, isAdmin: !!u.isAdmin, isStaff: !!u.isStaff };
}

async function mapTicket(ticket, order) {
  return {
    ticketId: ticket.ticketId,
    status: ticket.status,
    expiresAt: ticket.expiresAt,

    redeemStatus: ticket.redeemStatus,
    redeemedAt: ticket.redeemedAt,
    redeemedBy: ticket.redeemedBy ? await getRedeemerSafe(ticket.redeemedBy) : null,

    order: order
      ? {
          orderId: order.orderId,
          name: order.name,
          email: order.email,
          ticketCount: order.ticketCount,
          totalAmount: order.totalAmount,
          currency: order.currency,
          paymentStatus: order.paymentStatus,
          paidAt: order.paidAt || null,
        }
      : null,
  };
}

async function resolveQrAndTicket(qrText) {
  if (!qrText) throw new HttpError(400, "qrText is required");

  // allow raw token OR prefixed format
  const token = parseGalaQrText(qrText);
  if (!token) throw new HttpError(400, "Invalid QR format");

  const payload = verifyGalaQrJwtToken(token);

  const tokenHash = sha256(token);

  const ticket = await GalaTicket.findOne({ tokenHash });
  if (!ticket) throw new HttpError(404, "Ticket not found");

  if (ticket.status !== "ACTIVE") throw new HttpError(409, `Ticket is ${ticket.status}`);

  if (ticket.expiresAt && ticket.expiresAt <= new Date()) {
    ticket.status = "EXPIRED";
    await ticket.save().catch(() => {});
    throw new HttpError(401, "Ticket QR expired");
  }

  const order = await GalaOrder.findById(ticket.order);
  if (!order) throw new HttpError(404, "Order not found");

  if (order.paymentStatus !== "PAID") throw new HttpError(409, "Order is not PAID");

  // safety checks
  if (payload?.ticketId && payload.ticketId !== ticket.ticketId) {
    throw new HttpError(409, "QR does not match this ticket");
  }
  if (payload?.orderId && payload.orderId !== order.orderId) {
    throw new HttpError(409, "QR does not match this order");
  }

  return { tokenHash, ticket, order };
}

/** PREVIEW ONLY */
async function previewGalaRedeem({ qrText, staffUser }) {
  ensureStaff(staffUser);

  const { ticket, order } = await resolveQrAndTicket(qrText);

  return {
    ok: true,
    ticket: await mapTicket(ticket, order),
  };
}

/** CONFIRM REDEEM (atomic + idempotent) */
async function confirmGalaRedeem({ qrText, staffUser }) {
  const staffId = ensureStaff(staffUser);

  const { tokenHash, ticket, order } = await resolveQrAndTicket(qrText);

  if (ticket.redeemStatus === "REDEEMED") {
    return {
      ok: true,
      message: "Already redeemed",
      alreadyRedeemed: true,
      ticket: await mapTicket(ticket, order),
    };
  }

  const updated = await GalaTicket.findOneAndUpdate(
    {
      _id: ticket._id,
      tokenHash,
      status: "ACTIVE",
      redeemStatus: "NOT_REDEEMED",
    },
    {
      $set: {
        redeemStatus: "REDEEMED",
        redeemedAt: new Date(),
        redeemedBy: new mongoose.Types.ObjectId(staffId),
      },
    },
    { new: true }
  );

  if (!updated) {
    const fresh = await GalaTicket.findOne({ tokenHash });
    return {
      ok: true,
      message: "Already redeemed",
      alreadyRedeemed: true,
      ticket: await mapTicket(fresh || ticket, order),
    };
  }

  return {
    ok: true,
    message: "Redeemed",
    alreadyRedeemed: false,
    ticket: await mapTicket(updated, order),
  };
}

/** PREVIEW BY TICKET ID (fallback) — FIX: enforce PAID like QR flow */
async function previewGalaByTicketId({ ticketId, staffUser }) {
  ensureStaff(staffUser);
  if (!ticketId) throw new HttpError(400, "ticketId is required");

  const ticket = await GalaTicket.findOne({ ticketId });
  if (!ticket) throw new HttpError(404, "Ticket not found");

  if (ticket.status !== "ACTIVE") throw new HttpError(409, `Ticket is ${ticket.status}`);
  if (ticket.expiresAt && ticket.expiresAt <= new Date()) {
    ticket.status = "EXPIRED";
    await ticket.save().catch(() => {});
    throw new HttpError(401, "Ticket QR expired");
  }

  const order = await GalaOrder.findById(ticket.order);
  if (!order) throw new HttpError(404, "Order not found");
  if (order.paymentStatus !== "PAID") throw new HttpError(409, "Order is not PAID");

  return { ok: true, ticket: await mapTicket(ticket, order) };
}

/** CONFIRM BY TICKET ID (fallback) */
async function confirmGalaByTicketId({ ticketId, staffUser }) {
  const staffId = ensureStaff(staffUser);
  if (!ticketId) throw new HttpError(400, "ticketId is required");

  const ticket = await GalaTicket.findOne({ ticketId });
  if (!ticket) throw new HttpError(404, "Ticket not found");

  if (ticket.status !== "ACTIVE") throw new HttpError(409, `Ticket is ${ticket.status}`);
  if (ticket.expiresAt && ticket.expiresAt <= new Date()) {
    ticket.status = "EXPIRED";
    await ticket.save().catch(() => {});
    throw new HttpError(401, "Ticket QR expired");
  }

  const order = await GalaOrder.findById(ticket.order);
  if (!order) throw new HttpError(404, "Order not found");
  if (order.paymentStatus !== "PAID") throw new HttpError(409, "Order is not PAID");

  if (ticket.redeemStatus === "REDEEMED") {
    return {
      ok: true,
      message: "Already redeemed",
      alreadyRedeemed: true,
      ticket: await mapTicket(ticket, order),
    };
  }

  const updated = await GalaTicket.findOneAndUpdate(
    { _id: ticket._id, ticketId, status: "ACTIVE", redeemStatus: "NOT_REDEEMED" },
    {
      $set: {
        redeemStatus: "REDEEMED",
        redeemedAt: new Date(),
        redeemedBy: new mongoose.Types.ObjectId(staffId),
      },
    },
    { new: true }
  );

  if (!updated) {
    const fresh = await GalaTicket.findOne({ ticketId });
    return {
      ok: true,
      message: "Already redeemed",
      alreadyRedeemed: true,
      ticket: await mapTicket(fresh || ticket, order),
    };
  }

  return {
    ok: true,
    message: "Redeemed",
    alreadyRedeemed: false,
    ticket: await mapTicket(updated, order),
  };
}

module.exports = {
  previewGalaRedeem,
  confirmGalaRedeem,
  previewGalaByTicketId,
  confirmGalaByTicketId,
};