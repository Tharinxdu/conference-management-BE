const express = require("express");
const {
  getMyProfileController,
  createMyProfileController,
  updateMyProfileController,
} = require("../controllers/profile-controller");

const { requireAuth } = require("../middlewares/auth-middleware");

const router = express.Router();

// must login first
router.get("/me", requireAuth, getMyProfileController);

// popup submit (one-time)
router.post("/me", requireAuth, createMyProfileController);

// profile edit (only optional fields editable)
router.put("/me", requireAuth, updateMyProfileController);

module.exports = router;
