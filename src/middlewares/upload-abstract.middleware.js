const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { HttpError } = require("../utils/http-error");

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "abstracts");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `abs_${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`;
    cb(null, name);
  },
});

function fileFilter(req, file, cb) {
  const allowed = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  if (!allowed.includes(file.mimetype)) {
    return cb(new HttpError(400, "Only .pdf or .docx files are allowed."));
  }

  cb(null, true);
}

const uploadAbstractFiles = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

function toHttpError(err, { fieldName, maxCount } = {}) {
  // If you already threw HttpError in fileFilter, keep it
  if (err instanceof HttpError) return err;

  // Multer native errors
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return new HttpError(
        400,
        `File too large. Max allowed is ${Math.floor(MAX_FILE_SIZE / (1024 * 1024))}MB.`
      );
    }

    if (err.code === "LIMIT_FILE_COUNT") {
      return new HttpError(400, `Too many files. Max ${maxCount ?? 5} files allowed.`);
    }

    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return new HttpError(400, `Unexpected file field. Use '${fieldName ?? "files"}'.`);
    }

    return new HttpError(400, err.message || "File upload error.");
  }

  // Any other error
  return new HttpError(400, err?.message || "File upload failed.");
}

/**
 * ✅ Wrap multer so upload errors become HttpError and are sent via controller's sendError().
 */
function uploadAbstractFilesArray(fieldName, maxCount = 5) {
  return (req, res, next) => {
    uploadAbstractFiles.array(fieldName, maxCount)(req, res, (err) => {
      if (!err) return next();

      const httpErr = toHttpError(err, { fieldName, maxCount });

      // ✅ Attach for controller to send using sendError()
      req.uploadError = httpErr;

      // ✅ Continue request lifecycle (do NOT send response here)
      return next();
    });
  };
}

module.exports = { uploadAbstractFiles, uploadAbstractFilesArray, MAX_FILE_SIZE };
