const express = require("express");
const {
  registerController,
  loginController,
  refreshController,
  logoutController,
  meController,
  forgotPasswordController,
  resetPasswordController,
} = require("../controllers/auth-controller");
const { requireAuth } = require("../middlewares/auth-middleware");

const router = express.Router();

router.post("/register", registerController);
router.post("/login", loginController);
router.post("/refresh", refreshController);
router.post("/logout", requireAuth, logoutController);
router.get("/me", requireAuth, meController);
router.post("/forgot-password", forgotPasswordController);
router.post("/reset-password", resetPasswordController);

module.exports = router;
