const {
  createAbstract,
  listMyAbstracts,
  getMyAbstractById,
  updateMyAbstract,
  addAttachments,
  removeAttachment,
} = require("../services/abstract-service");

const { toAbstractDTO } = require("../helpers/abstract-helper");

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

module.exports = {
  createAbstractController,
  listMyAbstractsController,
  getMyAbstractController,
  updateMyAbstractController,
  addAttachmentsController,
  removeAttachmentController,
};
