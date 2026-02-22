const Registration = require("../models/Registration.js");
const mongoose = require("mongoose");

const {
  calculateFee,
  determineIncomeGroup,
  COUNTRY_INCOME_GROUPS,
  generateRandomId,
  sanitizeRegistrationUpdates,
  requireFields,
} = require("../helpers/registration-helper.js");

const { HttpError } = require("../utils/http-error.js");

/**
 * Create a new registration.
 * - Calculates income group + fee server-side
 * - Generates registrationId
 * - Forces paymentStatus = UNPAID
 */
async function createRegistration(payload) {
  try {
    // Minimal required fields for fee calculation + communication
    requireFields(payload, ["country", "conferenceType", "participantCategory", "email"]);

    const rawIncome = COUNTRY_INCOME_GROUPS[payload.country] || null;
    const incomeGroup = determineIncomeGroup(payload.country, rawIncome);

    if (!incomeGroup) {
      throw new HttpError(400, `Unknown country or income group: ${payload.country}`);
    }

    const feeData = calculateFee({
      conferenceType: payload.conferenceType,
      participantCategory: payload.participantCategory,
      incomeGroup,
    });

    if (!feeData) {
      throw new HttpError(400, "Unable to calculate fee for this selection.");
    }

    const registrationId = generateRandomId();

    const newReg = await Registration.create({
      registrationId,
      ...payload,
      // feeAmount: feeData.amount,
      feeAmount: 1, // --- IGNORE, for testing ---
      feePeriod: feeData.period,
      incomeGroup,
      paymentStatus: "UNPAID",
      feeBreakdown: feeData,
    });

    return newReg;
  } catch (err) {
    if (err?.code === 11000) {
      throw new HttpError(409, "Duplicate registration detected.", err?.keyValue);
    }

    if (err instanceof HttpError) throw err;

    if (err?.name === "ValidationError") {
      throw new HttpError(400, "Invalid registration data.", err?.errors);
    }

    console.error("createRegistration failed:", err);
    throw new HttpError(500, "Failed to create registration.");
  }
}

/**
 * List registrations (newest first).
 */
async function getAllRegistrations() {
  try {
    return await Registration.find().sort({ createdAt: -1 });
  } catch (err) {
    console.error("getAllRegistrations failed:", err);
    throw new HttpError(500, "Failed to fetch registrations.");
  }
}

/**
 * Get a single registration by Mongo _id
 */
async function getRegistrationById(id) {
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid registration id.");
    }

    const reg = await Registration.findById(id);
    if (!reg) throw new HttpError(404, "Registration not found");

    return reg;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("getRegistrationById failed:", err);
    throw new HttpError(500, "Failed to fetch registration.");
  }
}

/**
 * Get a single registration by registrationId (your public id)
 */
async function getRegistrationByRegistrationId(registrationId) {
  try {
    if (!registrationId) throw new HttpError(400, "registrationId is required.");

    const reg = await Registration.findOne({ registrationId });
    if (!reg) throw new HttpError(404, "Registration not found");

    return reg;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("getRegistrationByRegistrationId failed:", err);
    throw new HttpError(500, "Failed to fetch registration.");
  }
}

/**
 * Update a registration by Mongo _id.
 */
async function updateRegistrationById(id, updates) {
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid registration id.");
    }

    const current = await Registration.findById(id);
    if (!current) throw new HttpError(404, "Registration not found");

    const safeUpdates = sanitizeRegistrationUpdates(updates);

    const shouldRecalcFee =
      safeUpdates.country !== undefined ||
      safeUpdates.conferenceType !== undefined ||
      safeUpdates.participantCategory !== undefined;

    if (shouldRecalcFee) {
      const nextCountry = safeUpdates.country ?? current.country;
      const nextConferenceType = safeUpdates.conferenceType ?? current.conferenceType;
      const nextParticipantCategory =
        safeUpdates.participantCategory ?? current.participantCategory;

      const rawIncome = COUNTRY_INCOME_GROUPS[nextCountry] || null;
      const incomeGroup = determineIncomeGroup(nextCountry, rawIncome);

      if (!incomeGroup) {
        throw new HttpError(400, `Unknown country or income group: ${nextCountry}`);
      }

      const feeData = calculateFee({
        conferenceType: nextConferenceType,
        participantCategory: nextParticipantCategory,
        incomeGroup,
      });

      if (!feeData) {
        throw new HttpError(400, "Unable to calculate fee for this selection.");
      }

      safeUpdates.incomeGroup = incomeGroup;
      safeUpdates.feeAmount = feeData.amount;
      safeUpdates.feePeriod = feeData.period;
      safeUpdates.feeBreakdown = feeData;
    }

    const updated = await Registration.findByIdAndUpdate(id, safeUpdates, {
      new: true,
      runValidators: true,
    });

    return updated;
  } catch (err) {
    if (err instanceof HttpError) throw err;

    if (err?.name === "ValidationError") {
      throw new HttpError(400, "Invalid update data.", err?.errors);
    }

    console.error("updateRegistrationById failed:", err);
    throw new HttpError(500, "Failed to update registration.");
  }
}

/**
 * Delete a registration by Mongo _id (hard delete).
 */
async function deleteRegistrationById(id) {
  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new HttpError(400, "Invalid registration id.");
    }

    const deleted = await Registration.findByIdAndDelete(id);
    if (!deleted) throw new HttpError(404, "Registration not found");

    return deleted;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("deleteRegistrationById failed:", err);
    throw new HttpError(500, "Failed to delete registration.");
  }
}

module.exports = {
  createRegistration,
  getAllRegistrations,
  getRegistrationById,
  getRegistrationByRegistrationId,
  updateRegistrationById,
  deleteRegistrationById,
};
