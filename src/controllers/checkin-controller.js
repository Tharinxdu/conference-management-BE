const { previewCheckIn, confirmCheckIn, previewByRegistrationId,
  checkInByRegistrationId, } = require("../services/checkin-service");

async function previewQrController(req, res, next) {
  try {
    const result = await previewCheckIn({
      qrText: req.body?.qrText,
      adminUser: req.user,
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

async function confirmQrController(req, res, next) {
  try {
    const result = await confirmCheckIn({
      qrText: req.body?.qrText,
      adminUser: req.user,
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

async function previewByRegistrationIdController(req, res, next) {
  try {
    const result = await previewByRegistrationId({
      registrationId: req.body?.registrationId,
      adminUser: req.user,
    });
    return res.json(result);
  } catch (e) {
    next(e);
  }
}

async function checkInByRegistrationIdController(req, res, next) {
  try {
    const result = await checkInByRegistrationId({
      registrationId: req.body?.registrationId,
      adminUser: req.user,
    });
    return res.json(result);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  previewQrController,
  confirmQrController,
  previewByRegistrationIdController,
  checkInByRegistrationIdController,
};
