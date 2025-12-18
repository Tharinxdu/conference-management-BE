const ExcelJS = require("exceljs");
const { adminListAbstracts, adminUpdateAbstract } = require("../services/abstract-service");
const { toAbstractDTO } = require("../helpers/abstract-helper");

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
      items: result.items.map((d) => toAbstractDTO(d, req, { includeDeclarations: false })),
    });
  } catch (err) {
    return sendError(res, err);
  }
}

async function adminUpdateAbstractController(req, res) {
  try {
    const doc = await adminUpdateAbstract(req.params.id, req.body);
    return res.json(toAbstractDTO(doc, req, { includeDeclarations: false }));
  } catch (err) {
    return sendError(res, err);
  }
}

async function adminExportAbstractsController(req, res) {
  try {
    const { ownerId, status, search } = req.query;
    const result = await adminListAbstracts({ ownerId, status, search }, { page: 1, limit: 10000 });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Abstracts");

    ws.columns = [
      { header: "Abstract ID", key: "id", width: 26 },
      { header: "Owner Email", key: "ownerEmail", width: 26 },
      { header: "Presenting Author", key: "presentingAuthorName", width: 24 },
      { header: "Corresponding Author", key: "correspondingAuthorName", width: 24 },
      { header: "Corresponding Email", key: "correspondingAuthorEmail", width: 26 },
      { header: "Title", key: "abstractTitle", width: 40 },
      { header: "Presentation Types", key: "presentationTypes", width: 22 },
      { header: "Categories", key: "categories", width: 30 },
      { header: "Other Category", key: "otherCategoryText", width: 20 },
      { header: "Keywords", key: "keywords", width: 25 },
      { header: "Co-Authors (raw)", key: "coAuthorsRaw", width: 40 },
      { header: "Status", key: "status", width: 12 },
      { header: "Attachment Links", key: "attachments", width: 60 },
      { header: "Created At", key: "createdAt", width: 22 },
    ];

    for (const doc of result.items) {
      const dto = toAbstractDTO(doc, req, { includeDeclarations: false });
      ws.addRow({
        id: dto._id,
        ownerEmail: doc.owner?.email || "",
        presentingAuthorName: dto.presentingAuthorName,
        correspondingAuthorName: dto.correspondingAuthorName,
        correspondingAuthorEmail: dto.correspondingAuthorEmail,
        abstractTitle: dto.abstractTitle,
        presentationTypes: (dto.preferredPresentationTypes || []).join(", "),
        categories: (dto.scientificCategories || []).join(", "),
        otherCategoryText: dto.otherCategoryText || "",
        keywords: (dto.keywords || []).join(", "),
        coAuthorsRaw: dto.coAuthorsRaw || "",
        status: dto.status,
        attachments: (dto.attachments || []).map((a) => a.url).join(" | "),
        createdAt: dto.createdAt ? new Date(dto.createdAt).toISOString() : "",
      });
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
  adminExportAbstractsController,
};
