const { HttpError } = require("../utils/http-error");
const EmailService = require("./email-service"); 

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");

function mustEnv() {
  const required = ["ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_SECRET"];
  for (const k of required) if (!process.env[k]) throw new Error(`${k} missing in .env`);
}

function mustEnvKeys(keys = []) {
  for (const k of keys) if (!process.env[k]) throw new Error(`${k} missing in .env`);
}

function signAccessToken(user) {
  mustEnv();
  const expiresIn = process.env.ACCESS_TOKEN_EXPIRES_IN || "15m";
  return jwt.sign({ sub: user._id.toString(), email: user.email }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn,
  });
}

function signRefreshToken(user) {
  mustEnv();
  const expiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";
  return jwt.sign({ sub: user._id.toString() }, process.env.REFRESH_TOKEN_SECRET, { expiresIn });
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cookieOptions({ maxAgeMs }) {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd, // true in production (HTTPS)
    sameSite: "lax", // helps against CSRF in most cases
    maxAge: maxAgeMs,
    path: "/", // cookie available everywhere
  };
}

function parseDurationToMs(input, fallbackMs) {
  if (!input || typeof input !== "string") return fallbackMs;

  const m = input.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return fallbackMs;

  const n = Number(m[1]);
  const unit = m[2].toLowerCase();

  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * mult;
}

async function setAuthCookies(res, { accessToken, refreshToken }) {
  const accessExp = process.env.ACCESS_TOKEN_EXPIRES_IN || "15m";
  const refreshExp = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";

  const accessMaxAgeMs = parseDurationToMs(accessExp, 15 * 60 * 1000);
  const refreshMaxAgeMs = parseDurationToMs(refreshExp, 7 * 24 * 60 * 60 * 1000);

  res.cookie("access_token", accessToken, cookieOptions({ maxAgeMs: accessMaxAgeMs }));
  res.cookie("refresh_token", refreshToken, cookieOptions({ maxAgeMs: refreshMaxAgeMs }));
}


function clearAuthCookies(res) {
  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/" });
}

async function register({ email, password, confirmPassword }) {
  if (!email || !password || !confirmPassword) {
    return { ok: false, status: 400, message: "email, password, confirmPassword are required" };
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  if (password !== confirmPassword) {
    return { ok: false, status: 400, message: "password and confirmPassword do not match" };
  }
  if (password.length < 8) {
    return { ok: false, status: 400, message: "password must be at least 8 characters" };
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) return { ok: false, status: 409, message: "email already in use" };

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ email: normalizedEmail, passwordHash });

  // issue tokens
  // const accessToken = signAccessToken(user);
  // const refreshToken = signRefreshToken(user);

  // store hashed refresh token in DB (so we can invalidate)
  // user.refreshTokenHash = hashToken(refreshToken);
  await user.save();

  return {
    ok: true,
    status: 201,
    data: { message: "registered", user: { id: user._id.toString(), email: user.email } },
    // tokens: { accessToken, refreshToken },
  };
}

async function login({ email, password }) {
  if (!email || !password) {
    return { ok: false, status: 400, message: "email and password are required" };
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) return { ok: false, status: 401, message: "invalid credentials" };

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return { ok: false, status: 401, message: "invalid credentials" };

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  user.refreshTokenHash = hashToken(refreshToken);
  await user.save();

  return {
    ok: true,
    status: 200,
    data: { message: "logged in", user: { id: user._id.toString(), email: user.email } },
    tokens: { accessToken, refreshToken },
  };
}

function verifyAccessToken(token) {
  mustEnv();
  return jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
}

function verifyRefreshToken(token) {
  mustEnv();
  return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
}

async function refreshSession(refreshToken) {
  if (!refreshToken) return { ok: false, status: 401, message: "missing refresh token" };

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return { ok: false, status: 401, message: "invalid or expired refresh token" };
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.refreshTokenHash) {
    return { ok: false, status: 401, message: "session not found" };
  }

  const matches = user.refreshTokenHash === hashToken(refreshToken);
  if (!matches) {
    return { ok: false, status: 401, message: "refresh token mismatch (session revoked)" };
  }

  // rotate refresh token (recommended)
  const newAccessToken = signAccessToken(user);
  const newRefreshToken = signRefreshToken(user);
  user.refreshTokenHash = hashToken(newRefreshToken);
  await user.save();

  return {
    ok: true,
    status: 200,
    data: { message: "refreshed" },
    tokens: { accessToken: newAccessToken, refreshToken: newRefreshToken },
  };
}

async function logout(userId) {
  if (!userId) return;

  await User.updateOne({ _id: userId }, { $set: { refreshTokenHash: null } });
}

async function getUserSafeById(userId) {
  const user = await User.findById(userId).select("_id email isAdmin createdAt");
  if (!user) return null;

  return {
    _id: user._id,
    id: user._id.toString(),
    email: user.email,
    isAdmin: !!user.isAdmin,
    createdAt: user.createdAt,
  };
}

/**
 * FORGOT PASSWORD
 * - Always respond with 200 to avoid email enumeration
 * - If user exists -> generate reset token, store hash+expiry, send email with link
 */
async function requestPasswordReset({ email }) {
  if (!email) throw new HttpError(400, "email is required");

  mustEnvKeys(["CLIENT_ORIGIN"]);
  const expiresMinutes = Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES || 30);

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });

  // Always return success (prevent email enumeration)
  if (!user) {
    return {
      ok: true,
      status: 200,
      data: { message: "If this email exists, a reset link has been sent." },
    };
  }

  // Create a random token (NOT JWT). We store only hash in DB.
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  user.passwordResetTokenHash = tokenHash;
  user.passwordResetExpiresAt = new Date(Date.now() + expiresMinutes * 60 * 1000);
  user.passwordResetUsedAt = null;
  await user.save();

  // Reset URL goes to FRONTEND; frontend will call reset endpoint with token
  const resetUrl = `${process.env.CLIENT_ORIGIN}/reset-password?token=${rawToken}`;

  await EmailService.sendPasswordReset({
    to: user.email,
    resetUrl,
    expiresMinutes,
  });

  return {
    ok: true,
    status: 200,
    data: { message: "If this email exists, a reset link has been sent." },
  };
}

/**
 * RESET PASSWORD
 * - Verify token hash matches + not expired + not used
 * - Update passwordHash
 * - Invalidate reset token + revoke refresh sessions (optional but recommended)
 */
async function resetPassword({ token, newPassword, confirmPassword }) {
  if (!token || !newPassword || !confirmPassword) {
    throw new HttpError(400, "token, newPassword, confirmPassword are required");
  }
  if (newPassword !== confirmPassword) {
    throw new HttpError(400, "newPassword and confirmPassword do not match");
  }
  if (newPassword.length < 6) {
    throw new HttpError(400, "newPassword must be at least 6 characters");
  }

  const tokenHash = hashToken(String(token));

  const user = await User.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { $gt: new Date() },
    passwordResetUsedAt: null,
  });

  if (!user) throw new HttpError(400, "Invalid or expired reset token");

  user.passwordHash = await bcrypt.hash(newPassword, 12);

  // mark reset as used + invalidate token
  user.passwordResetUsedAt = new Date();
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;

  // revoke existing sessions (recommended)
  user.refreshTokenHash = null;

  await user.save();

  return {
    ok: true,
    status: 200,
    data: { message: "Password reset successful. Please login again." },
  };
}


module.exports = {
  register,
  login,
  refreshSession,
  logout,
  getUserSafeById,      // only once
  setAuthCookies,
  clearAuthCookies,
  verifyAccessToken,
  verifyRefreshToken,
  requestPasswordReset,
  resetPassword,
};

