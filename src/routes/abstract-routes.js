const express = require("express");
const { requireAuth } = require("../middlewares/auth-middleware");
const { uploadAbstractFiles,uploadAbstractFilesArray } = require("../middlewares/upload-abstract.middleware");

const {
  createAbstractController,
  listMyAbstractsController,
  getMyAbstractController,
  updateMyAbstractController,
  addAttachmentsController,
  removeAttachmentController,
  deleteMyAbstractController,
  saveMyAbstractAllInOneController
} = require("../controllers/abstract-controller");

const router = express.Router();

// Create (Declarations required) + optional files (multipart)
router.post("/", requireAuth, uploadAbstractFilesArray("files", 5), createAbstractController);

// List my abstracts
router.get("/", requireAuth, listMyAbstractsController);

// Get one (my own)
router.get("/:id", requireAuth, getMyAbstractController);

// Edit (Declarations NOT required)
router.put("/:id", requireAuth, updateMyAbstractController);

//Delete (my own)
router.delete("/:id", requireAuth, deleteMyAbstractController);

router.patch(
  "/:id",
  requireAuth,
  uploadAbstractFilesArray("files", 5),
  saveMyAbstractAllInOneController
);


// Add more files
router.post("/:id/attachments", requireAuth, uploadAbstractFiles.array("files", 5), addAttachmentsController);

// Remove one attachment
router.delete("/:id/attachments/:attachmentId", requireAuth, removeAttachmentController);

module.exports = router;
