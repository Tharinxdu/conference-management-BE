const {
  createAbstract,
  listMyAbstracts,
  getMyAbstractById,
  updateMyAbstract,
  addAttachments,
  removeAttachment,
  deleteMyAbstract,
  saveMyAbstractAllInOne
} = require("../services/abstract-service");

const { toAbstractDTO } = require("../helpers/abstract-helper");
const { HttpError } = require("../utils/http-error");

function sendError(res, err) {
  const status = err?.statusCode || 500;
  if (status >= 500) console.error(err);
  return res.status(status).json({
    message: err?.message || "Server error",
    ...(err?.details ? { details: err.details } : {}),
  });
}

// async function createAbstractController(req, res) {
//   try {
//     const doc = await createAbstract(req.user, req.body, req.files || []);
//     return res.status(201).json(toAbstractDTO(doc, req, { includeDeclarations: false }));
//   } catch (err) {
//     return sendError(res, err);
//   }
// }

async function createAbstractController(req, res) {
  try {
    if (req.uploadError) {
      return sendError(res, req.uploadError);
    }

    const doc = await createAbstract(req.user, req.body, req.files || []);
    return res.status(201).json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    return sendError(res, err);
  }
}


async function listMyAbstractsController(req, res) {
  try {
    const items = await listMyAbstracts(req.user);
    return res.json(items.map((d) => toAbstractDTO(d, req, { includeDeclarations: false })));
  } catch (err) {
    return sendError(res, err);
  }
}

async function getMyAbstractController(req, res) {
  try {
    const doc = await getMyAbstractById(req.user, req.params.id);
    return res.json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    return sendError(res, err);
  }
}

async function updateMyAbstractController(req, res) {
  try {
    const doc = await updateMyAbstract(req.user, req.params.id, req.body);
    return res.json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    return sendError(res, err);
  }
}

async function addAttachmentsController(req, res) {
  try {
    const doc = await addAttachments(req.user, req.params.id, req.files || []);
    return res.json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    return sendError(res, err);
  }
}

async function removeAttachmentController(req, res) {
  try {
    const doc = await removeAttachment(req.user, req.params.id, req.params.attachmentId);
    return res.json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    return sendError(res, err);
  }
}

async function deleteMyAbstractController(req, res) {
  try {
    const result = await deleteMyAbstract(req.user, req.params.id);
    return res.json(result); // { ok: true, message: "Abstract deleted" }
  } catch (err) {
    return sendError(res, err);
  }
}

// async function saveMyAbstractAllInOneController(req, res) {
//   try {
//     // Works with multipart/form-data:
//     // - text fields in req.body
//     // - files in req.files

//     // Expect:
//     // req.body.updates -> JSON string OR flattened fields
//     // req.body.removeAttachmentIds -> JSON string like ["id1","id2"] OR "ALL"

//     const updates =
//       typeof req.body?.updates === "string"
//         ? JSON.parse(req.body.updates)
//         : (req.body?.updates || req.body || {});

//     let removeAttachmentIds = req.body?.removeAttachmentIds ?? [];
//     if (typeof removeAttachmentIds === "string") {
//       // allow "ALL" or '["id1","id2"]'
//       removeAttachmentIds = removeAttachmentIds === "ALL" ? "ALL" : JSON.parse(removeAttachmentIds);
//     }

//     const doc = await saveMyAbstractAllInOne(
//       req.user,
//       req.params.id,
//       updates,
//       removeAttachmentIds,
//       req.files || []
//     );

//     return res.json(toAbstractDTO(doc, req, { includeDeclarations: false }));
//   } catch (err) {
//     return sendError(res, err);
//   }
// }

async function saveMyAbstractAllInOneController(req, res) {
  try {
    // ✅ If multer middleware captured an upload error, send it cleanly
    if (req.uploadError) {
      return sendError(res, req.uploadError);
    }

    // Works with multipart/form-data:
    // - text fields in req.body
    // - files in req.files
    //
    // Expect:
    // req.body.updates -> JSON string OR flattened fields
    // req.body.removeAttachmentIds -> JSON string like ["id1","id2"] OR "ALL"

    let updates = {};
    try {
      updates =
        typeof req.body?.updates === "string"
          ? JSON.parse(req.body.updates)
          : (req.body?.updates || req.body || {});
    } catch (e) {
      throw new HttpError(400, "Invalid JSON in 'updates'.");
    }

    let removeAttachmentIds = req.body?.removeAttachmentIds ?? [];
    if (typeof removeAttachmentIds === "string") {
      try {
        // allow "ALL" or '["id1","id2"]'
        removeAttachmentIds =
          removeAttachmentIds === "ALL" ? "ALL" : JSON.parse(removeAttachmentIds);
      } catch (e) {
        throw new HttpError(400, "Invalid JSON in 'removeAttachmentIds'.");
      }
    }

    const doc = await saveMyAbstractAllInOne(
      req.user,
      req.params.id,
      updates,
      removeAttachmentIds,
      req.files || []
    );

    return res.json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    return sendError(res, err);
  }
}


module.exports = {
  createAbstractController,
  listMyAbstractsController,
  getMyAbstractController,
  updateMyAbstractController,
  addAttachmentsController,
  removeAttachmentController,
  deleteMyAbstractController,
  saveMyAbstractAllInOneController,
};
