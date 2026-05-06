// src/controllers/gala-redeem-controller.js

const {
  previewGalaRedeem,
  confirmGalaRedeem,
  previewGalaByTicketId,
  confirmGalaByTicketId,
} = require("../services/gala-redeem-service");

async function previewGalaQrController(req, res, next) {
  try {
    const result = await previewGalaRedeem({
      qrText: req.body?.qrText,
      staffUser: req.user,
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

async function confirmGalaQrController(req, res, next) {
  try {
    const result = await confirmGalaRedeem({
      qrText: req.body?.qrText,
      staffUser: req.user,
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

async function previewByTicketIdController(req, res, next) {
  try {
    const result = await previewGalaByTicketId({
      ticketId: req.body?.ticketId,
      staffUser: req.user,
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

async function confirmByTicketIdController(req, res, next) {
  try {
    const result = await confirmGalaByTicketId({
      ticketId: req.body?.ticketId,
      staffUser: req.user,
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  previewGalaQrController,
  confirmGalaQrController,
  previewByTicketIdController,
  confirmByTicketIdController,
};