const mongoose = require("mongoose");
const GalaOrder = require("../models/GalaOrder");
const { HttpError } = require("../utils/http-error");
const EmailService = require("./email-service");
const { issueTicketsForOrder } = require("./gala-ticket-service");

async function finalizeGalaOrderAfterPayment({ galaOrderMongoId, paymentReference, paymentProvider = "ONEPAY" }) {
  if (!mongoose.Types.ObjectId.isValid(galaOrderMongoId)) {
    throw new HttpError(400, "Invalid gala order id.");
  }

  const order = await GalaOrder.findById(galaOrderMongoId);
  if (!order) throw new HttpError(404, "Gala order not found.");
  if (order.paymentStatus !== "PAID") throw new HttpError(409, "Order is not PAID.");

  if (paymentProvider && !order.paymentProvider) order.paymentProvider = paymentProvider;
  if (paymentReference && !order.paymentReference) order.paymentReference = paymentReference;
  await order.save().catch(() => {});

  // Idempotent issue/reuse tickets
  const tickets = await issueTicketsForOrder(order);

  // Send email ONCE
  if (!order.emailSentAt) {
    const attachments = tickets.map((t, idx) => ({
      filename: `APSC2026-GALA-${t.ticketId}-${idx + 1}.png`,
      content: t.pngBuffer,
      contentType: "image/png",
    }));

    const ticketIds = tickets.map((t) => t.ticketId);

    await EmailService.sendGalaDinnerTicketsEmail({
      to: order.email,
      orderId: order.orderId,
      ticketCount: order.ticketCount,
      ticketIds,
      attachments,
    });

    order.emailSentAt = new Date();
    await order.save();
  }

  return {
    ok: true,
    galaOrderMongoId: order._id.toString(),
    orderId: order.orderId,
    ticketCount: order.ticketCount,
    emailSentAt: order.emailSentAt,
  };
}

module.exports = { finalizeGalaOrderAfterPayment };