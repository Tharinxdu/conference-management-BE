const express = require("express");
const { requireAuth } = require("../middlewares/auth-middleware");
const { requireAdmin } = require("../middlewares/admin-middleware");

const {
  adminListAbstractsController,
  adminUpdateAbstractController,
  adminExportAbstractsController,
} = require("../controllers/admin-abstract-controller");

const router = express.Router();

// List with filters: ?ownerId=&status=&search=&page=&limit=
router.get("/", requireAuth, requireAdmin, adminListAbstractsController);

// Update any field + status
router.put("/:id", requireAuth, requireAdmin, adminUpdateAbstractController);

// Export to excel (same filters)
router.get("/export/excel", requireAuth, requireAdmin, adminExportAbstractsController);

module.exports = router;
