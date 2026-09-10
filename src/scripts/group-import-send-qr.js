// src/scripts/group-import-send-qr.js
//
// Bulk-import delegates who paid as a GROUP (no individual form / no OnePay
// checkout) and send each of them the standard registration confirmation email
// with their personal QR code.
//
// It reuses the exact production code path:
//   Registration (paymentStatus: PAID)  ->  finalizeRegistrationAfterPayment()
//     -> issueQrForRegistration()  (signed JWT, sha256 stored, linked to reg)
//     -> EmailService.sendRegistrationQrEmail()  (PNG attached, BCC applied)
//     -> RegistrationQr.emailSentAt  (guarantees one email per delegate)
//
// ---------------------------------------------------------------------------
// USAGE
//
//   # 1) DRY RUN (default) - validates everything, writes nothing, sends nothing
//   node src/scripts/group-import-send-qr.js \
//        --file=src/scripts/data/group-bangladesh.xlsx \
//        --group-ref=GRP-BD-2026
//
//   # 2) ONE REAL TEST SEND
//   node src/scripts/group-import-send-qr.js \
//        --file=src/scripts/data/group-bangladesh.xlsx \
//        --group-ref=GRP-BD-2026 \
//        --only=doc.lemon@gmail.com --confirm
//
//   # 3) THE REST
//   node src/scripts/group-import-send-qr.js \
//        --file=src/scripts/data/group-bangladesh.xlsx \
//        --group-ref=GRP-BD-2026 --confirm
//
// FLAGS
//   --file=<path>           .xlsx or .json delegate list              (required)
//   --sheet=<name>          worksheet name (default: first sheet)
//   --group-ref=<ref>       value stored as Registration.paymentReference
//                           (default: GROUP-<YYYYMMDD>)
//   --provider=<name>       Registration.paymentProvider (default GROUP_BANK_TRANSFER)
//   --currency=USD|LKR      Registration.paymentCurrency (default USD)
//   --conference-type=full|rehab   applied when the sheet has no column (default full)
//   --fee=<number>          override the rule-derived fee (e.g. a negotiated
//                           group rate, or to keep the EARLY price after 30 Sep)
//   --only=<a@b,c@d>        process only these email addresses
//   --promote-existing      if a delegate already has a non-PAID registration,
//                           mark it PAID and send instead of skipping it
//   --delay=<ms>            pause between sends (default 2500) - SMTP throttling
//   --offline               dry-run without touching MongoDB at all - validates
//                           the sheet, columns, countries and fees only
//   --confirm               actually write to MongoDB and send emails
//
// Run it from the cf-backend root so dotenv picks up .env.
// Needs: MONGODB_URI, QR_SIGNING_SECRET, SMTP_HOST, SMTP_USER, SMTP_PASS,
//        EMAIL_FROM_ADDRESS (+ optional APSC_REGISTRATION_BCC_EMAILS,
//        QR_TOKEN_EXPIRES_IN_DAYS, QR_PREFIX)
// ---------------------------------------------------------------------------

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const ExcelJS = require("exceljs");

const Registration = require("../models/Registration");
const {
  COUNTRY_INCOME_GROUPS,
  determineIncomeGroup,
  calculateFee,
  generateRandomId,
} = require("../helpers/registration-helper.js");
// NOTE: required lazily. registration-confirmation-service -> email-service ->
// config/email.js validates SMTP_* at require time, so importing it up front
// would make --offline sheet validation impossible on a machine without .env.
function getFinalizer() {
  return require("../services/registration-confirmation-service").finalizeRegistrationAfterPayment;
}

const REQUIRED_SEND_ENV = [
  "MONGODB_URI",
  "QR_SIGNING_SECRET",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "EMAIL_FROM_ADDRESS",
];

function missingSendEnv() {
  return REQUIRED_SEND_ENV.filter((n) => !process.env[n]);
}

/* ------------------------------- arguments ------------------------------- */

function parseArgs(argv) {
  const out = { _: [] };
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith("--")) {
      out._.push(raw);
      continue;
    }
    const eq = raw.indexOf("=");
    if (eq === -1) out[raw.slice(2)] = true;
    else out[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return out;
}

const args = parseArgs(process.argv);

const CONFIRM = args.confirm === true || args.confirm === "true";
const DEFAULT_FILE = path.join(__dirname, "data", "delegates.xlsx");
const FILE = args.file && args.file !== true ? args.file : DEFAULT_FILE;
const SHEET = args.sheet || null;
const PROVIDER = args.provider || "GROUP_BANK_TRANSFER";
const CURRENCY = (args.currency || "USD").toUpperCase();
const DEFAULT_CONFERENCE_TYPE = (args["conference-type"] || "full").toLowerCase();
const FEE_OVERRIDE = args.fee != null && args.fee !== true ? Number(args.fee) : null;
const PROMOTE_EXISTING = args["promote-existing"] === true || args["promote-existing"] === "true";
const OFFLINE = args.offline === true || args.offline === "true";
const DELAY_MS = args.delay != null && args.delay !== true ? Number(args.delay) : 2500;
const ONLY = args.only && args.only !== true
  ? String(args.only).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  : null;

function defaultGroupRef() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return `GROUP-${stamp}`;
}
const GROUP_REF = args["group-ref"] && args["group-ref"] !== true ? String(args["group-ref"]) : defaultGroupRef();

/* --------------------------------- utils --------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normHeader(h) {
  return String(h == null ? "" : h).replace(/\s+/g, " ").trim().toLowerCase();
}

function cellText(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    // ExcelJS rich text / hyperlink / formula cell shapes
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v.hyperlink != null) return String(v.hyperlink);
    return "";
  }
  return String(v);
}

const HEADER_ALIASES = {
  title: ["title", "salutation"],
  firstName: ["first name", "firstname", "given name", "name"],
  lastName: ["last name", "lastname", "surname", "family name"],
  designationRaw: [
    "designation / position",
    "designation/position",
    "designation / institution",
    "designation",
    "position",
  ],
  institution: ["institution", "affiliation", "hospital", "organisation", "organization"],
  country: ["country"],
  email: ["email address", "email", "e-mail", "e mail", "mail"],
  category: [
    "physician / non physician",
    "physician/non physician",
    "physician / nonphysician",
    "participant category",
    "category",
    "type",
  ],
  mobile: ["mobile", "mobile number", "phone", "phone number", "contact number", "contact"],
  conferenceType: ["conference type", "conferencetype", "conference"],
};

function buildHeaderIndex(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = normHeader(h);
    if (!key) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] !== undefined) continue;
      if (aliases.includes(key)) map[field] = i;
    }
  });
  return map;
}

function normalizeCategory(raw) {
  const k = String(raw || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!k) return null;
  if (k === "physician" || k === "doctor" || k === "md") return "physician";
  if (k === "nonphysician" || k === "nonphysicians" || k === "allied") return "non-physician";
  return null;
}

function splitDesignation(designationRaw, institutionCol) {
  const raw = String(designationRaw || "").trim();
  const inst = String(institutionCol || "").trim();
  if (inst) return { designation: raw, institution: inst };
  const comma = raw.indexOf(",");
  if (comma === -1) return { designation: raw, institution: "" };
  return {
    designation: raw.slice(0, comma).trim(),
    institution: raw.slice(comma + 1).trim(),
  };
}

/* -------------------------------- loading -------------------------------- */

// Rows as they really sit in the workbook: true Excel row numbers, blank rows
// dropped. A sheet can have blank or title rows above the header.
function sheetRows(ws) {
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      values[col - 1] = cellText(cell.value).trim();
    });
    if (values.some((v) => v)) out.push({ number: row.number, values });
  });
  return out;
}

// The header is the first row (within the first 10 non-empty rows) that carries
// both a name column and an email column.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const idx = buildHeaderIndex(rows[i].values);
    if (idx.email !== undefined && idx.firstName !== undefined) return { at: i, idx };
  }
  return null;
}

async function loadRowsFromXlsx(filePath, sheetName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  let ws = null;
  let rows = null;
  let header = null;

  if (sheetName) {
    ws = wb.getWorksheet(sheetName);
    if (!ws) {
      throw new Error(
        `Worksheet "${sheetName}" not found. Available: ${wb.worksheets.map((w) => w.name).join(", ")}`
      );
    }
    rows = sheetRows(ws);
    header = findHeaderRow(rows);
    if (!header) {
      throw new Error(
        `Worksheet "${ws.name}" has no header row with both a name and an email column. ` +
          `First row seen: ${rows[0]?.values.join(" | ") || "(empty sheet)"}`
      );
    }
  } else {
    // Auto-pick: the first sheet that looks like a delegate list, so a
    // reference / dropdown sheet in the same workbook is skipped.
    for (const candidate of wb.worksheets) {
      const candidateRows = sheetRows(candidate);
      const candidateHeader = findHeaderRow(candidateRows);
      if (candidateHeader) {
        ws = candidate;
        rows = candidateRows;
        header = candidateHeader;
        break;
      }
    }
    if (!ws) {
      throw new Error(
        `No worksheet with both a name and an email column found. Sheets: ${wb.worksheets
          .map((w) => w.name)
          .join(", ")}`
      );
    }
    if (wb.worksheets.length > 1) console.log(`Using worksheet "${ws.name}".`);
  }

  const headerIdx = header.idx;
  const get = (values, field) =>
    headerIdx[field] === undefined ? "" : String(values[headerIdx[field]] || "").trim();

  const delegates = [];
  for (let i = header.at + 1; i < rows.length; i++) {
    const { number, values } = rows[i];

    // Guard against a repeated header further down the sheet.
    if (normHeader(get(values, "email")) === "email address") continue;

    const { designation, institution } = splitDesignation(
      get(values, "designationRaw"),
      get(values, "institution")
    );

    delegates.push({
      sheetRow: number,
      sheetName: ws.name,
      title: get(values, "title"),
      firstName: get(values, "firstName"),
      lastName: get(values, "lastName"),
      designation,
      institution,
      country: get(values, "country"),
      email: get(values, "email").toLowerCase(),
      mobile: get(values, "mobile"),
      participantCategoryRaw: get(values, "category"),
      conferenceTypeRaw: get(values, "conferenceType"),
    });
  }

  return delegates;
}

function loadRowsFromJson(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const list = Array.isArray(parsed) ? parsed : parsed.delegates;
  if (!Array.isArray(list)) throw new Error("JSON must be an array, or { delegates: [...] }.");

  return list.map((d, i) => {
    const { designation, institution } = splitDesignation(
      d.designation ?? d["Designation / Position"],
      d.institution
    );
    return {
      sheetRow: i + 1,
      sheetName: path.basename(filePath),
      title: String(d.title || "").trim(),
      firstName: String(d.firstName || d["First Name"] || "").trim(),
      lastName: String(d.lastName || d["Last Name"] || "").trim(),
      designation,
      institution,
      country: String(d.country || "").trim(),
      email: String(d.email || d["Email Address"] || "").trim().toLowerCase(),
      mobile: String(d.mobile || "").trim(),
      participantCategoryRaw: String(d.participantCategory || d["Physician / Non Physician"] || "").trim(),
      conferenceTypeRaw: String(d.conferenceType || "").trim(),
    };
  });
}

async function loadRows(filePath, sheetName) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") return loadRowsFromJson(filePath);
  if (ext === ".xlsx" || ext === ".xlsm") return loadRowsFromXlsx(filePath, sheetName);
  throw new Error(`Unsupported file type "${ext}". Use .xlsx or .json.`);
}

/* ------------------------------- validation ------------------------------ */

function validateAndPrice(row) {
  const problems = [];

  if (!row.firstName) problems.push("missing first name");
  if (!row.email) problems.push("missing email");
  else if (!EMAIL_RE.test(row.email)) problems.push(`invalid email "${row.email}"`);

  const conferenceType = (row.conferenceTypeRaw || DEFAULT_CONFERENCE_TYPE).toLowerCase();
  if (!["full", "rehab"].includes(conferenceType)) {
    problems.push(`unknown conference type "${conferenceType}"`);
  }

  const participantCategory = normalizeCategory(row.participantCategoryRaw) || "physician";
  if (!row.participantCategoryRaw) {
    problems.push('no physician/non-physician column value - defaulted to "physician"');
  }

  let incomeGroup = null;
  if (!row.country) {
    problems.push("missing country");
  } else {
    const rawIncome = COUNTRY_INCOME_GROUPS[row.country] || null;
    incomeGroup = determineIncomeGroup(row.country, rawIncome);
    if (!incomeGroup) {
      problems.push(
        `country "${row.country}" is not in COUNTRY_INCOME_GROUPS - fix the spelling to match the official list`
      );
    }
  }

  let fee = null;
  if (incomeGroup && ["full", "rehab"].includes(conferenceType)) {
    fee = calculateFee({ conferenceType, participantCategory, incomeGroup });
    if (!fee) problems.push("fee rules produced no amount for this combination");
  }

  if (FEE_OVERRIDE != null) {
    if (!Number.isFinite(FEE_OVERRIDE) || FEE_OVERRIDE < 0) {
      problems.push(`invalid --fee value "${args.fee}"`);
    } else {
      fee = { amount: FEE_OVERRIDE, period: fee?.period || "early", overridden: true };
    }
  }

  // Blocking problems vs. warnings
  const blocking = problems.filter((p) => !p.includes("defaulted to"));

  return {
    ok: blocking.length === 0 && !!fee,
    problems,
    blocking,
    conferenceType,
    participantCategory,
    incomeGroup,
    fee,
  };
}

async function uniqueRegistrationId() {
  for (let i = 0; i < 15; i++) {
    const candidate = generateRandomId();
    const clash = await Registration.exists({ registrationId: candidate });
    if (!clash) return candidate;
  }
  throw new Error("Could not generate a unique registrationId after 15 attempts.");
}

/* --------------------------------- report -------------------------------- */

function writeReport(results) {
  const dir = path.join(__dirname, "output");
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mode = CONFIRM ? "live" : "dryrun";
  const base = path.join(dir, `group-import-${mode}-${stamp}`);

  fs.writeFileSync(`${base}.json`, JSON.stringify({ groupRef: GROUP_REF, results }, null, 2));

  const head = [
    "sheetRow",
    "email",
    "name",
    "registrationId",
    "designation",
    "institution",
    "country",
    "incomeGroup",
    "category",
    "conferenceType",
    "feeAmount",
    "feePeriod",
    "status",
    "emailSent",
    "notes",
  ];
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [head.join(",")];
  for (const r of results) {
    lines.push(
      [
        r.sheetRow,
        r.email,
        r.name,
        r.registrationId,
        r.designation,
        r.institution,
        r.country,
        r.incomeGroup,
        r.participantCategory,
        r.conferenceType,
        r.feeAmount,
        r.feePeriod,
        r.status,
        r.emailSent,
        (r.notes || []).join(" | "),
      ]
        .map(esc)
        .join(",")
    );
  }
  fs.writeFileSync(`${base}.csv`, lines.join("\n"));

  return `${base}.csv`;
}

/* ---------------------------------- main --------------------------------- */

async function main() {
  const filePath = path.isAbsolute(FILE) ? FILE : path.resolve(process.cwd(), FILE);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `File not found: ${filePath}\n` +
        `Drop the delegate sheet at src/scripts/data/delegates.xlsx, or pass --file=<path>.`
    );
  }

  if (!["USD", "LKR"].includes(CURRENCY)) {
    throw new Error(`--currency must be USD or LKR (got "${CURRENCY}")`);
  }

  if (OFFLINE && CONFIRM) throw new Error("--offline cannot be combined with --confirm.");

  console.log("=".repeat(78));
  console.log(
    CONFIRM
      ? "LIVE RUN - will write to MongoDB and SEND EMAILS"
      : OFFLINE
      ? "OFFLINE DRY RUN - sheet validation only, MongoDB not contacted"
      : "DRY RUN - no writes, no emails"
  );
  console.log("=".repeat(78));
  console.log(`file            : ${filePath}`);
  console.log(`sheet           : ${SHEET || "(first)"}`);
  console.log(`group reference : ${GROUP_REF}`);
  console.log(`provider        : ${PROVIDER}`);
  console.log(`currency        : ${CURRENCY}`);
  console.log(`conference type : ${DEFAULT_CONFERENCE_TYPE} (when sheet has no column)`);
  console.log(`fee             : ${FEE_OVERRIDE != null ? `OVERRIDE ${FEE_OVERRIDE}` : "rule-derived (FEE_RULES)"}`);
  if (ONLY) console.log(`only            : ${ONLY.join(", ")}`);
  if (PROMOTE_EXISTING) console.log("promote-existing: ON");
  console.log("");

  const missingEnv = missingSendEnv();
  if (missingEnv.length) {
    if (CONFIRM) {
      throw new Error(
        `Missing env var(s): ${missingEnv.join(", ")}. Run from the cf-backend root so .env is picked up.`
      );
    }
    console.log(`(heads-up) env not set for sending: ${missingEnv.join(", ")}\n`);
  }

  let rows = await loadRows(filePath, SHEET);
  console.log(`Parsed ${rows.length} row(s) from "${rows[0]?.sheetName}".`);

  if (ONLY) {
    const before = rows.length;
    rows = rows.filter((r) => ONLY.includes(r.email));
    console.log(`Filtered to ${rows.length} of ${before} row(s) by --only.`);
    const notFound = ONLY.filter((e) => !rows.some((r) => r.email === e));
    if (notFound.length) console.log(`  !! not found in sheet: ${notFound.join(", ")}`);
  }
  if (!rows.length) {
    console.log("Nothing to do.");
    return;
  }

  // duplicate emails inside the sheet itself
  const seen = new Map();
  for (const r of rows) {
    seen.set(r.email, (seen.get(r.email) || 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([e]) => e);
  if (dupes.length) console.log(`!! duplicate emails inside the sheet: ${dupes.join(", ")}`);

  if (OFFLINE) {
    console.log("Skipping MongoDB connection (--offline): duplicate checks are not performed.\n");
  } else {
    if (!process.env.MONGODB_URI) throw new Error("Missing env var: MONGODB_URI");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB.\n");
  }

  const results = [];
  let created = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const name = [row.title, row.firstName, row.lastName].filter(Boolean).join(" ");
    const label = `row ${row.sheetRow}  ${row.email.padEnd(34)} ${name}`;

    const v = validateAndPrice(row);
    const result = {
      sheetRow: row.sheetRow,
      email: row.email,
      name,
      registrationId: "",
      designation: row.designation,
      institution: row.institution,
      country: row.country,
      incomeGroup: v.incomeGroup,
      participantCategory: v.participantCategory,
      conferenceType: v.conferenceType,
      feeAmount: v.fee?.amount,
      feePeriod: v.fee?.period,
      status: "",
      emailSent: false,
      notes: [...v.problems],
    };

    if (!v.ok) {
      result.status = "INVALID";
      failed++;
      console.log(`[INVALID ] ${label}\n            ${v.blocking.join("; ")}`);
      results.push(result);
      continue;
    }

    try {
      // --- existing registration for this email? ---------------------------
      const existingPaid = OFFLINE
        ? null
        : await Registration.findOne({ email: row.email, paymentStatus: "PAID" });
      const existingOther = OFFLINE || existingPaid
        ? null
        : await Registration.findOne({ email: row.email }).sort({ createdAt: -1 });

      let reg = null;

      if (existingPaid) {
        reg = existingPaid;
        result.registrationId = reg.registrationId;
        result.notes.push(`already PAID in DB (${reg.registrationId})`);
      } else if (existingOther && !PROMOTE_EXISTING) {
        result.status = "SKIPPED";
        result.registrationId = existingOther.registrationId;
        result.notes.push(
          `existing ${existingOther.paymentStatus} registration ${existingOther.registrationId} - re-run with --promote-existing to mark it PAID and send`
        );
        skipped++;
        console.log(`[SKIP    ] ${label}\n            existing ${existingOther.paymentStatus} registration ${existingOther.registrationId}`);
        results.push(result);
        continue;
      } else if (existingOther && PROMOTE_EXISTING) {
        reg = existingOther;
        result.registrationId = reg.registrationId;
        result.notes.push(`promoted existing ${existingOther.paymentStatus} registration to PAID`);

        if (CONFIRM) {
          reg.paymentStatus = "PAID";
          reg.paymentProvider = PROVIDER;
          reg.paymentReference = GROUP_REF;
          reg.paymentCurrency = CURRENCY;
          reg.feeAmount = v.fee.amount;
          reg.feePeriod = v.fee.period;
          reg.feeBreakdown = v.fee;
          reg.incomeGroup = v.incomeGroup;
          await reg.save();
        }
      }

      // --- create a fresh PAID registration --------------------------------
      if (!reg) {
        if (!CONFIRM) {
          result.status = "WOULD CREATE + SEND";
          created++;
          sent++;
          console.log(
            `[WOULD   ] ${label}\n            ${v.incomeGroup}/${v.participantCategory}/${v.conferenceType} -> ${CURRENCY} ${v.fee.amount} (${v.fee.period})`
          );
          results.push(result);
          continue;
        }

        const registrationId = await uniqueRegistrationId();
        reg = await Registration.create({
          registrationId,
          title: row.title,
          firstName: row.firstName,
          lastName: row.lastName,
          designation: row.designation,
          institution: row.institution,
          country: row.country,

          incomeGroup: v.incomeGroup,
          participantCategory: v.participantCategory,
          conferenceType: v.conferenceType,
          feeAmount: v.fee.amount,
          feePeriod: v.fee.period,
          feeBreakdown: v.fee,

          email: row.email,
          mobile: row.mobile || undefined,

          consentDataUse: true,
          consentTerms: true,

          paymentStatus: "PAID",
          paymentProvider: PROVIDER,
          paymentReference: GROUP_REF,
          paymentCurrency: CURRENCY,
        });

        result.registrationId = reg.registrationId;
        created++;
      }

      // --- dry run for the existing-registration branches -------------------
      if (!CONFIRM) {
        result.status = "WOULD SEND";
        console.log(`[WOULD   ] ${label}\n            would issue QR + email for ${result.registrationId}`);
        results.push(result);
        continue;
      }

      // --- issue QR + send email (production code path) ---------------------
      const finalize = await getFinalizer()({
        registrationMongoId: reg._id,
        paymentReference: GROUP_REF,
        paymentProvider: PROVIDER,
      });

      result.emailSent = finalize.emailSent;
      result.status = finalize.emailSent ? "SENT" : "ALREADY SENT";
      if (finalize.reused) result.notes.push("reused existing QR");
      if (!finalize.emailSent) result.notes.push("emailSentAt already stamped - not re-sent");

      if (finalize.emailSent) sent++;
      else skipped++;

      console.log(
        `[${finalize.emailSent ? "SENT    " : "ALREADY "}] ${label}\n            ${result.registrationId}  ${CURRENCY} ${v.fee.amount}  qr=${finalize.qrId}`
      );

      if (DELAY_MS > 0) await sleep(DELAY_MS);
    } catch (err) {
      failed++;
      result.status = "FAILED";
      result.notes.push(err?.message || String(err));
      console.log(`[FAILED  ] ${label}\n            ${err?.message || err}`);
    }

    results.push(result);
  }

  const reportPath = writeReport(results);

  console.log("\n" + "=".repeat(78));
  console.log(CONFIRM ? "LIVE RUN SUMMARY" : "DRY RUN SUMMARY (nothing was written or sent)");
  console.log("=".repeat(78));
  const pad = (label) => label.padEnd(15);
  console.log(`${pad("rows processed")}: ${results.length}`);
  console.log(`${pad(CONFIRM ? "created" : "would create")}: ${created}`);
  console.log(`${pad(CONFIRM ? "emails sent" : "would email")}: ${sent}`);
  console.log(`${pad("skipped")}: ${skipped}`);
  console.log(`${pad("failed/invalid")}: ${failed}`);
  console.log(`${pad("report")}: ${reportPath}`);
  if (!CONFIRM) console.log("\nAdd --confirm to actually create registrations and send emails.");
}

main()
  .then(async () => {
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\nScript failed:", err?.message || err);
    if (err?.stack) console.error(err.stack);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
