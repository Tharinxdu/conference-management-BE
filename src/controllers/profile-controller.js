const {
  getMyProfile,
  createMyProfile,
  updateMyProfile,
} = require("../services/profile-service");

function sendError(res, err) {
  const status = err?.statusCode || 500;
  if (status >= 500) console.error(err);
  return res.status(status).json({
    message: err?.message || "Server error",
    ...(err?.details ? { details: err.details } : {}),
  });
}

async function getMyProfileController(req, res) {
  try {
    const profile = await getMyProfile(req.user);
    return res.json({
      hasProfile: !!profile,
      profile,
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function createMyProfileController(req, res) {
  try {
    const profile = await createMyProfile(req.user, req.body);
    return res.status(201).json(profile);
  } catch (err) {
    return sendError(res, err);
  }
}

async function updateMyProfileController(req, res) {
  try {
    const profile = await updateMyProfile(req.user, req.body);
    return res.json(profile);
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  getMyProfileController,
  createMyProfileController,
  updateMyProfileController,
};
