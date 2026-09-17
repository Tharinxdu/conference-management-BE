// FILE: src/controllers/registration-directory-controller.js
//
// Admin + staff views over the "ready for the desk" registration directory
// (PAID and QR issued). Both roles read the same service so the two dashboards
// can never drift apart; only the Excel export is admin-only.

const ExcelJS = require("exceljs");

const {
  listPaidRegistrationsWithQr,
  listPaidRegistrationsWithQrForExport,
} = require("../services/registration-directory-service");

const {
  setupSheet,
  applyRowBandingAndGrid,
  applyOuterBorder,
  styleStatusCell,
  formatDateCell,
  sendWorkbook,
} = require("../utils/excel/excel-style");

function sendError(res, err) {
  const status = err?.statusCode || 500;
  if (status >= 500) console.error(err);

  // A streamed workbook may already have flushed headers; nothing to do but abort.
  if (res.headersSent) return res.end();

  return res.status(status).json({
    message: err?.message || "Server error",
    ...(err?.details ? { details: err.details } : {}),
  });
}

function readListQuery(req) {
  const { page, limit, q, conferenceType, checkInStatus, sortBy, sortDir } = req.query || {};
  return {
    page,
    limit,
    q: String(q || "").trim(),
    conferenceType: String(conferenceType || "").trim(),
    checkInStatus: String(checkInStatus || "").trim(),
    sortBy: String(sortBy || "").trim() || undefined,
    sortDir: String(sortDir || "").trim() || undefined,
  };
}

/** GET /api/admin/registrations */
async function adminListRegistrationsController(req, res) {
  try {
    const data = await listPaidRegistrationsWithQr(readListQuery(req));
    return res.json(data);
  } catch (err) {
    return sendError(res, err);
  }
}

/** GET /api/staff/dashboard/registrations */
async function staffListRegistrationsController(req, res) {
  try {
    const data = await listPaidRegistrationsWithQr(readListQuery(req));
    return res.json(data);
  } catch (err) {
    return sendError(res, err);
  }
}

const CHECK_IN_TONES = {
  checked_in: { bg: "FFDCFCE7", text: "FF14532D" }, // green
  not_checked_in: { bg: "FFFEF9C3", text: "FF713F12" }, // amber
};

const QR_STATUS_TONES = {
  active: { bg: "FFDBEAFE", text: "FF0C4A6E" }, // blue
  revoked: { bg: "FFFEE2E2", text: "FF7F1D1D" }, // red
  expired: { bg: "FFFEE2E2", text: "FF7F1D1D" },
};

function fullName(row) {
  return [row.title, row.firstName, row.lastName].filter(Boolean).join(" ").trim();
}

function exportFilename() {
  const stamp = new Date().toISOString().slice(0, 10);
  return `registrations-${stamp}.xlsx`;
}

/**
 * GET /api/admin/registrations/export/excel
 * Honours the same filters as the listing, so the file matches the screen.
 */
async function adminExportRegistrationsController(req, res) {
  try {
    const rows = await listPaidRegistrationsWithQrForExport(readListQuery(req));

    const wb = new ExcelJS.Workbook();
    wb.creator = "APSC Admin";
    wb.created = new Date();

    const ws = wb.addWorksheet("Registrations");

    ws.columns = [
      { header: "Registration ID", key: "registrationId", width: 20 },
      { header: "Full Name", key: "fullName", width: 28 },
      { header: "First Name", key: "firstName", width: 18 },
      { header: "Last Name", key: "lastName", width: 18 },
      { header: "Designation", key: "designation", width: 20 },
      { header: "Institution", key: "institution", width: 32 },
      { header: "Country", key: "country", width: 18 },
      { header: "Participant Category", key: "participantCategory", width: 20 },
      { header: "Conference Type", key: "conferenceType", width: 18 },
      { header: "Email", key: "email", width: 30 },
      { header: "Mobile", key: "mobile", width: 18 },
      { header: "QR Status", key: "qrStatus", width: 14 },
      { header: "QR Issued At", key: "qrIssuedAt", width: 20 },
      { header: "Check-in Status", key: "checkInStatus", width: 18 },
      { header: "Checked In At", key: "checkedInAt", width: 20 },
      { header: "Checked In By", key: "checkedInByEmail", width: 28 },
      { header: "Registered At", key: "registeredAt", width: 20 },
    ];

    const lastCol = ws.columns.length;
    setupSheet(ws, { lastCol });

    const dateKeys = new Set(["qrIssuedAt", "checkedInAt", "registeredAt"]);
    const qrStatusCol = ws.getColumn("qrStatus").number;
    const checkInStatusCol = ws.getColumn("checkInStatus").number;

    for (const r of rows) {
      const row = ws.addRow({
        registrationId: r.registrationId || "",
        fullName: fullName(r),
        firstName: r.firstName || "",
        lastName: r.lastName || "",
        designation: r.designation || "",
        institution: r.institution || "",
        country: r.country || "",
        participantCategory: r.participantCategory || "",
        conferenceType: r.conferenceType || "",
        email: r.email || "",
        mobile: r.mobile || "",
        qrStatus: r.qr?.status || "",
        qrIssuedAt: r.qr?.issuedAt ? new Date(r.qr.issuedAt) : null,
        checkInStatus: r.qr?.checkInStatus || "",
        checkedInAt: r.qr?.checkedInAt ? new Date(r.qr.checkedInAt) : null,
        checkedInByEmail: r.qr?.checkedInByEmail || "",
        registeredAt: r.registeredAt ? new Date(r.registeredAt) : null,
      });

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };

        const key = ws.columns[colNumber - 1]?.key;
        if (dateKeys.has(key)) formatDateCell(cell);
      });

      styleStatusCell(row.getCell(qrStatusCol), r.qr?.status, QR_STATUS_TONES);
      styleStatusCell(row.getCell(checkInStatusCol), r.qr?.checkInStatus, CHECK_IN_TONES);
    }

    if (ws.rowCount >= 2) applyRowBandingAndGrid(ws, 2, ws.rowCount, lastCol);
    applyOuterBorder(ws, lastCol);

    await sendWorkbook(res, wb, exportFilename());
  } catch (err) {
    return sendError(res, err);
  }
}

module.exports = {
  adminListRegistrationsController,
  staffListRegistrationsController,
  adminExportRegistrationsController,
};
