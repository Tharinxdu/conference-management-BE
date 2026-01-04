const express = require("express");
const { requireAuth } = require("../middlewares/auth-middleware");
const { requireAdmin } = require("../middlewares/admin-middleware");
const { uploadAbstractFiles,uploadAbstractFilesArray } = require("../middlewares/upload-abstract.middleware");

const {
  adminListAbstractsController,
  adminUpdateAbstractController,
  adminExportAbstractsController,
  adminDeleteAbstractController,
  adminUpdateAbstractStatusController
} = require("../controllers/admin-abstract-controller");

const router = express.Router();

// List with filters: ?ownerId=&status=&search=&page=&limit=
router.get("/", requireAuth, requireAdmin, adminListAbstractsController);

// Update any field
router.patch("/:id", requireAuth, requireAdmin, adminUpdateAbstractController);

// Update status only
router.put("/:id/status", requireAuth, requireAdmin,uploadAbstractFilesArray("files", 5), adminUpdateAbstractStatusController);

// Delete any abstract
router.delete("/:id", requireAuth, requireAdmin, adminDeleteAbstractController);

// Export to excel (same filters)
router.get("/export/excel", requireAuth, requireAdmin, adminExportAbstractsController);

module.exports = router;
