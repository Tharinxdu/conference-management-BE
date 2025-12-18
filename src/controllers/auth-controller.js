const AuthService = require("../services/auth-service");
const {
  requestPasswordReset,
  resetPassword,
} = require("../services/auth-service");

async function registerController(req, res) {
  const result = await AuthService.register(req.body);
  if (!result.ok) return res.status(result.status).json({ message: result.message });

  await AuthService.setAuthCookies(res, result.tokens);
  return res.status(result.status).json(result.data);
}

async function loginController(req, res) {
  const result = await AuthService.login(req.body);
  if (!result.ok) return res.status(result.status).json({ message: result.message });

  await AuthService.setAuthCookies(res, result.tokens);
  return res.status(result.status).json(result.data);
}

async function refreshController(req, res) {
  const refreshToken = req.cookies?.refresh_token;

  const result = await AuthService.refreshSession(refreshToken);
  if (!result.ok) return res.status(result.status).json({ message: result.message });

  await AuthService.setAuthCookies(res, result.tokens);
  return res.status(result.status).json(result.data);
}

async function logoutController(req, res) {
  // If user is logged in, revoke refresh token in DB
  const refreshToken = req.cookies?.refresh_token;

  // best-effort revoke: if refresh token exists and is valid, revoke user session
  try {
    // We don’t strictly need to decode here, but we can just clear cookies anyway.
    // Keeping it simple: clear cookies + wipe session if req.user exists.
    if (req.user?.id) await AuthService.logout(req.user.id);
  } catch { }

  AuthService.clearAuthCookies(res);
  return res.json({ message: "logged out" });
}

async function meController(req, res) {
  return res.json({ user: req.user });
}

function sendService(res, result) {
  if (!result?.ok) return res.status(result?.status || 500).json({ message: result?.message || "Server error" });
  return res.status(result.status).json(result.data);
}

async function forgotPasswordController(req, res) {
  try {
    const result = await requestPasswordReset(req.body);
    return sendService(res, result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message || "Server error" });
  }
}

async function resetPasswordController(req, res) {
  try {
    const result = await resetPassword(req.body);
    return sendService(res, result);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ message: err.message || "Server error" });
  }
}

module.exports = {
  registerController,
  loginController,
  refreshController,
  logoutController,
  meController,
  forgotPasswordController,
  resetPasswordController,
};
