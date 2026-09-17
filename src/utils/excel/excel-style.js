// FILE: src/utils/excel/excel-style.js
//
// Small, reusable ExcelJS presentation helpers so every export in the app
// looks like it came from the same place: dark header bar, zebra rows,
// full grid, coloured status pills.

const PALETTE = {
  headerBg: "FF0F172A", // slate-900
  headerText: "FFFFFFFF",
  headerBorder: "FF334155", // slate-700
  gridLine: "FFE2E8F0", // slate-200
  outerLine: "FFCBD5E1", // slate-300
  zebra: "FFF8FAFC", // slate-50
  link: "FF2563EB",
};

const DATE_FORMAT = "yyyy-mm-dd hh:mm";

/** Dark, frozen, filterable header row. */
function applyHeaderStyle(ws, headerRowNumber = 1, lastCol = ws.columns.length) {
  const row = ws.getRow(headerRowNumber);
  row.height = 26;

  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);

    cell.font = { bold: true, color: { argb: PALETTE.headerText } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.headerBg } };
    cell.border = {
      top: { style: "thin", color: { argb: PALETTE.headerBorder } },
      left: { style: "thin", color: { argb: PALETTE.headerBorder } },
      right: { style: "thin", color: { argb: PALETTE.headerBorder } },
      bottom: { style: "medium", color: { argb: PALETTE.headerBorder } },
    };
  }
}

function applyGridBorder(cell, { color = PALETTE.gridLine, style = "thin" } = {}) {
  cell.border = {
    top: { style, color: { argb: color } },
    left: { style, color: { argb: color } },
    right: { style, color: { argb: color } },
    bottom: { style, color: { argb: color } },
  };
}

/** Zebra striping + grid lines across the data range. */
function applyRowBandingAndGrid(ws, fromRow, toRow, lastCol, { rowHeight = 22 } = {}) {
  for (let r = fromRow; r <= toRow; r++) {
    const row = ws.getRow(r);
    const isAlt = r % 2 === 0;

    if (!row.height) row.height = rowHeight;

    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);

      applyGridBorder(cell);

      // Never overwrite a fill a caller already set (e.g. a status pill).
      if (isAlt && !cell.fill) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALETTE.zebra } };
      }

      if (!cell.alignment) {
        cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
      }
    }
  }
}

/** Heavier border around the whole used range, so the sheet reads as one table. */
function applyOuterBorder(ws, lastCol = ws.columns.length) {
  const lastRow = ws.rowCount;
  if (lastRow < 1) return;

  for (let c = 1; c <= lastCol; c++) {
    const cell = ws.getRow(lastRow).getCell(c);
    cell.border = {
      ...(cell.border || {}),
      bottom: { style: "medium", color: { argb: PALETTE.outerLine } },
    };
  }

  for (let r = 1; r <= lastRow; r++) {
    const left = ws.getRow(r).getCell(1);
    left.border = {
      ...(left.border || {}),
      left: { style: "medium", color: { argb: PALETTE.outerLine } },
    };

    const right = ws.getRow(r).getCell(lastCol);
    right.border = {
      ...(right.border || {}),
      right: { style: "medium", color: { argb: PALETTE.outerLine } },
    };
  }
}

/**
 * Coloured "pill" for a status cell.
 * `tones` maps a lowercased status to { bg, text } ARGB pairs.
 */
function styleStatusCell(cell, statusRaw, tones = {}) {
  const key = String(statusRaw || "").trim().toLowerCase();
  const tone = tones[key] || { bg: "FFE2E8F0", text: "FF0F172A" };

  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.bg } };
  cell.font = { bold: true, color: { argb: tone.text } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
}

/** Format a cell holding a Date, leaving non-dates as a blank string. */
function formatDateCell(cell, numFmt = DATE_FORMAT) {
  if (cell.value instanceof Date) {
    cell.numFmt = numFmt;
    cell.alignment = { vertical: "top", horizontal: "left", wrapText: false };
    return;
  }
  cell.value = cell.value || "";
}

/** Freeze the header, add the filter row, and hide the default gridlines. */
function setupSheet(ws, { lastCol = ws.columns.length, defaultRowHeight = 18 } = {}) {
  ws.properties.defaultRowHeight = defaultRowHeight;
  ws.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: lastCol } };
  applyHeaderStyle(ws, 1, lastCol);
}

/** Stream a workbook to an Express response as a .xlsx download. */
async function sendWorkbook(res, wb, filename) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  await wb.xlsx.write(res);
  res.end();
}

module.exports = {
  PALETTE,
  DATE_FORMAT,
  applyHeaderStyle,
  applyGridBorder,
  applyRowBandingAndGrid,
  applyOuterBorder,
  styleStatusCell,
  formatDateCell,
  setupSheet,
  sendWorkbook,
};
