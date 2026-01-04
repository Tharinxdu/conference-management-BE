const ExcelJS = require("exceljs");
const {
  adminListAbstracts,
  adminUpdateAbstract,
  adminSaveAbstractAllInOne,
  adminUpdateAbstractStatus,
  adminDeleteAbstract,
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

async function adminListAbstractsController(req, res) {
  try {
    const { ownerId, status, search, page, limit } = req.query;
    const result = await adminListAbstracts(
      { ownerId, status, search },
      { page: page || 1, limit: limit || 25 }
    );

    return res.json({
      ...result,
      items: result.items.map((d) =>
        toAbstractDTO(d, req, { includeDeclarations: false })
      ),
    });
  } catch (err) {
    return sendError(res, err);
  }
}

function parseJsonIfString(v) {
  if (v == null) return v;
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s) return v;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

function normalizeRemoveAttachmentIds(raw) {
  if (raw == null) return [];

  if (raw === "ALL") return "ALL";

  if (Array.isArray(raw)) {
    if (raw.includes("ALL")) return "ALL";
    return raw.map(String).filter(Boolean);
  }

  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    if (s === "ALL") return "ALL";

    const parsed = parseJsonIfString(s);
    if (parsed === "ALL") return "ALL";
    if (Array.isArray(parsed)) {
      if (parsed.includes("ALL")) return "ALL";
      return parsed.map(String).filter(Boolean);
    }

    return [s];
  }

  return [];
}

// NOTE: this endpoint stays “all-in-one save” for admin edits (same as user save)
// If you want to change status, use adminUpdateAbstractStatusController below (wire it to a route).
async function adminUpdateAbstractController(req, res) {
  try {
    const updates =
      typeof req.body?.updates === "string"
        ? JSON.parse(req.body.updates)
        : req.body?.updates || req.body || {};

    // keep the all-in-one save same as user: do NOT allow status here
    if (updates && Object.prototype.hasOwnProperty.call(updates, "status")) {
      delete updates.status;
    }

    const removeAttachmentIds = normalizeRemoveAttachmentIds(
      req.body?.removeAttachmentIds
    );

    const files = req.files || [];

    let doc;
    if (typeof adminSaveAbstractAllInOne === "function") {
      doc = await adminSaveAbstractAllInOne(
        req.params.id,
        updates,
        removeAttachmentIds,
        files
      );
    } else {
      doc = await adminUpdateAbstract(req.params.id, updates);
    }

    return res.json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    if (err instanceof SyntaxError) {
      return sendError(res, new HttpError(400, "Invalid JSON in request body."));
    }
    return sendError(res, err);
  }
}

// ✅ Separate controller for status-only updates (wire to your existing route as needed)
async function adminUpdateAbstractStatusController(req, res) {
  try {
    const rawStatus =
      req.body?.status ??
      (typeof req.body?.updates === "string"
        ? (parseJsonIfString(req.body.updates) || {}).status
        : req.body?.updates?.status);

    if (rawStatus == null || String(rawStatus).trim() === "") {
      throw new HttpError(400, "Missing required field: status");
    }

    const doc = await adminUpdateAbstractStatus(req.params.id, rawStatus);
    return res.json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    return sendError(res, err);
  }
}

async function adminDeleteAbstractController(req, res) {
  try {
    const result = await adminDeleteAbstract(req.params.id);
    return res.json(result);
  } catch (err) {
    return sendError(res, err);
  }
}

function buildAttachmentUrlFromContext(req, storedName) {
  // ASSUMPTION: Attachments are served from "/uploads/abstracts/<storedName>" (matches disk storage location)
  if (!storedName) return "";
  const base = `${req.protocol}://${req.get("host")}`;
  return `${base}/uploads/abstracts/${encodeURIComponent(storedName)}`;
}

function applyHeaderStyle(ws, headerRowNumber, toColNumber) {
  const row = ws.getRow(headerRowNumber);
  row.height = 22;

  for (let c = 1; c <= toColNumber; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: "FF0F172A" } };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF1F5F9" },
    };
    cell.border = {
      bottom: { style: "medium", color: { argb: "FFCBD5E1" } },
    };
  }
}

function styleStatusCell(cell, statusRaw) {
  const s = String(statusRaw || "").trim().toLowerCase();

  let fg = "FFE2E8F0";
  let font = "FF0F172A";

  if (s === "submitted") {
    fg = "FFDBEAFE";
    font = "FF0C4A6E";
  } else if (s === "under-review" || s === "under_review" || s === "underreview") {
    fg = "FFFEF9C3";
    font = "FF713F12";
  } else if (s === "approved") {
    fg = "FFDCFCE7";
    font = "FF14532D";
  } else if (s === "rejected") {
    fg = "FFFEE2E2";
    font = "FF7F1D1D";
  }

  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fg } };
  cell.font = { bold: true, color: { argb: font } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
}

// ✅ Replace your applyHeaderStyle with this improved version
function applyHeaderStyle(ws, headerRowNumber, toColNumber) {
  const row = ws.getRow(headerRowNumber);
  row.height = 26;

  for (let c = 1; c <= toColNumber; c++) {
    const cell = row.getCell(c);

    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };

    // dark header bar
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0F172A" }, // slate-900
    };

    // full grid border + stronger bottom edge
    cell.border = {
      top: { style: "thin", color: { argb: "FF334155" } },
      left: { style: "thin", color: { argb: "FF334155" } },
      right: { style: "thin", color: { argb: "FF334155" } },
      bottom: { style: "medium", color: { argb: "FF334155" } },
    };
  }
}

function applyGridBorder(cell, opts = {}) {
  const color = opts.color || "FFE2E8F0"; // light slate
  const style = opts.style || "thin";

  cell.border = {
    top: { style, color: { argb: color } },
    left: { style, color: { argb: color } },
    right: { style, color: { argb: color } },
    bottom: { style, color: { argb: color } },
  };
}

function applyRowBandingAndGrid(ws, fromRow, toRow, lastCol) {
  for (let r = fromRow; r <= toRow; r++) {
    const row = ws.getRow(r);
    const alt = r % 2 === 0;

    // slightly tighter than 48, but still roomy for wrapped text
    if (!row.height) row.height = 44;

    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);

      // Full grid border (makes columns/rows clearly separated)
      applyGridBorder(cell, { color: "FFE2E8F0", style: "thin" });

      // Banding fill (only if not already filled, e.g. status pill fill)
      if (alt && !cell.fill) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" }, // very light
        };
      }

      // consistent alignment across sheet
      if (!cell.alignment) {
        cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
      }
    }
  }
}

// ✅ Your controller with the styling improvements applied
async function adminExportAbstractsController(req, res) {
  try {
    const { ownerId, status, search } = req.query;
    const result = await adminListAbstracts(
      { ownerId, status, search },
      { page: 1, limit: 10000 }
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = "APSC Admin";
    wb.created = new Date();

    const ws = wb.addWorksheet("Abstracts", {
      views: [{ state: "frozen", ySplit: 1, showGridLines: false }], // ✅ cleaner look (we draw our own grid)
    });

    ws.columns = [
      { header: "Abstract ID", key: "id", width: 26 },
      { header: "Status", key: "status", width: 14 },

      { header: "Owner Email", key: "ownerEmail", width: 26 },

      { header: "Profile First Name", key: "profileFirstName", width: 16 },
      { header: "Profile Last Name", key: "profileLastName", width: 16 },
      { header: "Profile Email", key: "profileEmail", width: 26 },
      { header: "Profile Country", key: "profileCountry", width: 16 },

      { header: "Presenting Author (Text)", key: "presentingAuthorName", width: 24 },
      { header: "Corresponding Author", key: "correspondingAuthorName", width: 24 },
      { header: "Corresponding Email", key: "correspondingAuthorEmail", width: 26 },

      { header: "Title", key: "abstractTitle", width: 44 },
      { header: "Abstract Text", key: "abstractText", width: 60 },

      { header: "Presentation Types", key: "presentationTypes", width: 22 },
      { header: "Categories", key: "categories", width: 30 },
      { header: "Other Category", key: "otherCategoryText", width: 22 },
      { header: "Keywords", key: "keywords", width: 28 },
      { header: "Co-Authors (raw)", key: "coAuthorsRaw", width: 44 },

      { header: "Attachment 1", key: "att1", width: 28 },
      { header: "Attachment 2", key: "att2", width: 28 },
      { header: "Attachment 3", key: "att3", width: 28 },
      { header: "Attachment 4", key: "att4", width: 28 },
      { header: "Attachment 5", key: "att5", width: 28 },

      { header: "Submitted At", key: "submittedAt", width: 20 },
      { header: "Updated At", key: "updatedAt", width: 20 },
      { header: "Created At", key: "createdAt", width: 20 },
    ];

    const lastCol = ws.columns.length;

    // ✅ sheet-wide defaults
    ws.properties.defaultRowHeight = 18;

    // ✅ header styling
    applyHeaderStyle(ws, 1, lastCol);

    // ✅ filter row
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: lastCol },
    };

    // ✅ optional: make the first 2 columns a bit more “table-like”
    ws.getColumn(1).alignment = { vertical: "top", horizontal: "left", wrapText: false };
    ws.getColumn(2).alignment = { vertical: "middle", horizontal: "center", wrapText: true };

    const dateNumFmt = "yyyy-mm-dd hh:mm";

    for (const doc of result.items) {
      const dto = toAbstractDTO(doc, req, { includeDeclarations: false });

      const attachments = Array.isArray(dto.attachments) ? dto.attachments : [];
      const links = attachments.slice(0, 5).map((a) => {
        const url =
          a?.url ||
          buildAttachmentUrlFromContext(req, a?.storedName || a?.stored_name);
        const text =
          a?.originalName ||
          a?.original_name ||
          a?.storedName ||
          a?.stored_name ||
          "Attachment";
        if (!url) return null;
        return { text, hyperlink: url, tooltip: url };
      });

      const row = ws.addRow({
        id: dto._id || dto.id || "",
        status: dto.status || "",

        ownerEmail: doc.owner?.email || "",

        profileFirstName: doc.presentingAuthorProfile?.firstName || "",
        profileLastName: doc.presentingAuthorProfile?.lastName || "",
        profileEmail: doc.presentingAuthorProfile?.email || "",
        profileCountry: doc.presentingAuthorProfile?.country || "",

        presentingAuthorName: dto.presentingAuthorName || "",
        correspondingAuthorName: dto.correspondingAuthorName || "",
        correspondingAuthorEmail: dto.correspondingAuthorEmail || "",

        abstractTitle: dto.abstractTitle || "",
        abstractText: dto.abstractText || "",

        presentationTypes: (dto.preferredPresentationTypes || []).join(", "),
        categories: (dto.scientificCategories || []).join(", "),
        otherCategoryText: dto.otherCategoryText || "",
        keywords: (dto.keywords || []).join(", "),
        coAuthorsRaw: dto.coAuthorsRaw || "",

        att1: links[0] || "",
        att2: links[1] || "",
        att3: links[2] || "",
        att4: links[3] || "",
        att5: links[4] || "",

        submittedAt: dto.submittedAt ? new Date(dto.submittedAt) : null,
        updatedAt: dto.updatedAt ? new Date(dto.updatedAt) : null,
        createdAt: dto.createdAt ? new Date(dto.createdAt) : null,
      });

      // ✅ content cells alignment + date formatting
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const isStatus = colNumber === 2;

        cell.alignment = {
          vertical: "top",
          horizontal: isStatus ? "center" : "left",
          wrapText: true,
        };

        const colKey = ws.columns[colNumber - 1]?.key;
        if (colKey === "createdAt" || colKey === "updatedAt" || colKey === "submittedAt") {
          if (cell.value instanceof Date) {
            cell.numFmt = dateNumFmt;
            cell.alignment = { vertical: "top", horizontal: "left", wrapText: false };
          } else {
            cell.value = cell.value ? cell.value : "";
          }
        }
      });

      // ✅ status pill style (keeps your current nice colors)
      const statusCell = row.getCell(2);
      styleStatusCell(statusCell, dto.status);

      // ✅ hyperlink styling for attachments
      for (let i = 0; i < 5; i++) {
        const colIndex = ws.getColumn("att1").number + i;
        const cell = row.getCell(colIndex);
        if (cell.value && typeof cell.value === "object" && cell.value.hyperlink) {
          cell.font = { color: { argb: "FF2563EB" }, underline: true };
          cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
        }
      }
    }

    // ✅ apply full grid borders + row banding to ALL data rows
    if (ws.rowCount >= 2) {
      applyRowBandingAndGrid(ws, 2, ws.rowCount, lastCol);
    }

    // ✅ add an outer border to the whole used range (slightly darker)
    // makes the sheet feel like a “card/table”
    const outerColor = "FFCBD5E1";
    const lastRow = ws.rowCount;
    if (lastRow >= 1) {
      for (let c = 1; c <= lastCol; c++) {
        // top outer is header (already styled), left+right will be reinforced below
        const bottomCell = ws.getRow(lastRow).getCell(c);
        bottomCell.border = {
          ...(bottomCell.border || {}),
          bottom: { style: "medium", color: { argb: outerColor } },
        };
      }
      for (let r = 1; r <= lastRow; r++) {
        const leftCell = ws.getRow(r).getCell(1);
        leftCell.border = {
          ...(leftCell.border || {}),
          left: { style: "medium", color: { argb: outerColor } },
        };

        const rightCell = ws.getRow(r).getCell(lastCol);
        rightCell.border = {
          ...(rightCell.border || {}),
          right: { style: "medium", color: { argb: outerColor } },
        };
      }
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="abstracts.xlsx"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    return sendError(res, err);
  }
}


module.exports = {
  adminListAbstractsController,
  adminUpdateAbstractController,
  adminUpdateAbstractStatusController,
  adminExportAbstractsController,
  adminDeleteAbstractController,
};
