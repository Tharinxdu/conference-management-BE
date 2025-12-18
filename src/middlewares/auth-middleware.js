const { verifyAccessToken, getUserSafeById } = require("../services/auth-service");

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.access_token;
    if (!token) return res.status(401).json({ message: "missing access token" });

    const payload = verifyAccessToken(token);

    const user = await getUserSafeById(payload.sub);
    if (!user) return res.status(401).json({ message: "user not found" });

    const _id = user._id || user.id || payload.sub;

    req.user = { ...user, _id, id: user.id || String(_id) };

    next();
  } catch (err) {
    return res.status(401).json({ message: "invalid or expired access token" });
  }
}

module.exports = { requireAuth };
