function requireStaff(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });
  if (req.user.isAdmin || req.user.isStaff) return next();
  return res.status(403).json({ message: "Staff access required" });
}

module.exports = { requireStaff };