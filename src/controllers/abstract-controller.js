const {
  createAbstract,
  listMyAbstracts,
  getMyAbstractById,
  updateMyAbstract,
  addAttachments,
  removeAttachment,
  deleteMyAbstract,
  saveMyAbstractAllInOne,
} = require("../services/abstract-service");

const { toAbstractDTO } = require("../helpers/abstract-helper");
const { HttpError } = require("../utils/http-error");

/* =========================================================
   Abstract submission closure switch

   Default is CLOSED because submission date is over.

   This blocks normal user mutation endpoints:
   - create abstract
   - update/edit abstract
   - add attachments
   - remove attachments
   - delete abstract
   - save all-in-one

   View/list endpoints remain open.

   To reopen submissions later, add this to .env:
   ABSTRACT_SUBMISSIONS_CLOSED=false
   ========================================================= */
const ABSTRACT_SUBMISSIONS_CLOSED =
  String(process.env.ABSTRACT_SUBMISSIONS_CLOSED ?? "true").toLowerCase() === "true";

const ABSTRACT_CLOSED_MESSAGE =
  process.env.ABSTRACT_CLOSED_MESSAGE ||
  "Abstract submission period is closed. You can only view submitted abstracts.";

function assertAbstractSubmissionsOpen() {
  if (ABSTRACT_SUBMISSIONS_CLOSED) {
    throw new HttpError(403, ABSTRACT_CLOSED_MESSAGE);
  }
}

function sendError(res, err) {
  const status = err?.statusCode || 500;
  if (status >= 500) console.error(err);

  return res.status(status).json({
    message: err?.message || "Server error",
    ...(err?.details ? { details: err.details } : {}),
  });
}

async function createAbstractController(req, res) {
  try {
    assertAbstractSubmissionsOpen();

    if (req.uploadError) {
      return sendError(res, req.uploadError);
    }

    const doc = await createAbstract(req.user, req.body, req.files || []);

    return res
      .status(201)
      .json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    return sendError(res, err);
  }
}

async function listMyAbstractsController(req, res) {
  try {
    const items = await listMyAbstracts(req.user);

    return res.json(
      items.map((d) => toAbstractDTO(d, req, { includeDeclarations: false }))
    );
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
    assertAbstractSubmissionsOpen();

    const doc = await updateMyAbstract(req.user, req.params.id, req.body);

    return res.json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    return sendError(res, err);
  }
}

async function addAttachmentsController(req, res) {
  try {
    assertAbstractSubmissionsOpen();

    if (req.uploadError) {
      return sendError(res, req.uploadError);
    }

    const doc = await addAttachments(req.user, req.params.id, req.files || []);

    return res.json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    return sendError(res, err);
  }
}

async function removeAttachmentController(req, res) {
  try {
    assertAbstractSubmissionsOpen();

    const doc = await removeAttachment(
      req.user,
      req.params.id,
      req.params.attachmentId
    );

    return res.json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    return sendError(res, err);
  }
}

async function deleteMyAbstractController(req, res) {
  try {
    assertAbstractSubmissionsOpen();

    const result = await deleteMyAbstract(req.user, req.params.id);

    return res.json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

async function saveMyAbstractAllInOneController(req, res) {
  try {
    assertAbstractSubmissionsOpen();

    if (req.uploadError) {
      return sendError(res, req.uploadError);
    }

    let updates = {};
    try {
      updates =
        typeof req.body?.updates === "string"
          ? JSON.parse(req.body.updates)
          : req.body?.updates || req.body || {};
    } catch (e) {
      throw new HttpError(400, "Invalid JSON in 'updates'.");
    }

    let removeAttachmentIds = req.body?.removeAttachmentIds ?? [];

    if (typeof removeAttachmentIds === "string") {
      try {
        removeAttachmentIds =
          removeAttachmentIds === "ALL"
            ? "ALL"
            : JSON.parse(removeAttachmentIds);
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