const express = require("express");

const {
  createRegistrationController,
  listRegistrationsController,
  getRegistrationByIdController,
  getRegistrationByRegistrationIdController,
  updateRegistrationController,
  deleteRegistrationController,
} = require("../controllers/registration-controller.js"); // ensure filename matches

const { requireAuth } = require("../middlewares/auth-middleware.js"); // ensure filename matches
const { requireAdmin } = require("../middlewares/admin-middleware.js"); // ensure filename matches

const router = express.Router();

// Public: create registration
router.post("/", createRegistrationController);

// Admin-only: view all registrations
router.get("/", requireAuth, requireAdmin, listRegistrationsController);

// ✅ Put this BEFORE "/:id" to avoid conflict
router.get("/by-code/:registrationId", requireAuth, requireAdmin, getRegistrationByRegistrationIdController);

// Admin-only: view single by Mongo _id
router.get("/:id", requireAuth, requireAdmin, getRegistrationByIdController);

// Admin-only: edit + delete
router.put("/:id", requireAuth, requireAdmin, updateRegistrationController);
router.delete("/:id", requireAuth, requireAdmin, deleteRegistrationController);

module.exports = router;
