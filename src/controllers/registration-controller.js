const {
  createRegistration,
  getAllRegistrations,
  getRegistrationById,
  getRegistrationByRegistrationId,
  updateRegistrationById,
  deleteRegistrationById,
} = require("../services/registration-service.js");

function sendError(res, err) {
    const status = err?.statusCode || 500;
    return res.status(status).json({
        message: err?.message || "Server error",
        ...(err?.details ? { details: err.details } : {}),
    });
}

async function createRegistrationController(req, res) {
    try {
        const reg = await createRegistration(req.body);
        return res.status(201).json(reg);
    } catch (err) {
        return sendError(res, err);
    }
}

async function listRegistrationsController(req, res) {
    try {
        const regs = await getAllRegistrations();
        return res.json(regs);
    } catch (err) {
        return sendError(res, err);
    }
}

async function getRegistrationByIdController(req, res) {
    try {
        const reg = await getRegistrationById(req.params.id);
        return res.json(reg);
    } catch (err) {
        return sendError(res, err);
    }
}

// If you prefer using query param instead of a dedicated route,
// you can remove this and use /registrations?registrationId=XXXX
async function getRegistrationByRegistrationIdController(req, res) {
    try {
        const reg = await getRegistrationByRegistrationId(req.params.registrationId);
        return res.json(reg);
    } catch (err) {
        return sendError(res, err);
    }
}

async function updateRegistrationController(req, res) {
    try {
        const updated = await updateRegistrationById(req.params.id, req.body);
        return res.json(updated);
    } catch (err) {
        return sendError(res, err);
    }
}

async function deleteRegistrationController(req, res) {
    try {
        const deleted = await deleteRegistrationById(req.params.id);
        return res.json({ message: "Registration deleted", deleted });
    } catch (err) {
        return sendError(res, err);
    }
}

module.exports = {
  createRegistrationController,
  listRegistrationsController,
  getRegistrationByIdController,
  getRegistrationByRegistrationIdController,
  updateRegistrationController,
  deleteRegistrationController,
};
