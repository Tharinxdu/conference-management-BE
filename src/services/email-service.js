const { sendEmail } = require("../utils/email/send-email");

const { passwordResetTemplate } = require("../utils/email/templates/password-reset");
const { abstractSubmittedTemplate } = require("../utils/email/templates/abstract-submitted");
const { registrationQrTemplate } = require("../utils/email/templates/registration-qr-template");
const { galaDinnerTemplate } = require("../utils/email/templates/gala-dinner-template");

function parseBccFromEnv() {
  const raw = process.env.APSC_REGISTRATION_BCC_EMAILS || "";
  const emails = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return emails.length ? emails : undefined;
}

async function sendPasswordReset({ to, resetUrl, expiresMinutes }) {
  const tpl = passwordResetTemplate({ resetUrl, expiresMinutes });
  return sendEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  });
}

async function sendAbstractSubmitted({ to, firstName, abstractId, abstractTitle, presentation }) {
  const tpl = abstractSubmittedTemplate({
    firstName,
    abstractId,
    abstractTitle,
    presentation,
  });

  return sendEmail({
    to,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  });
}

async function sendRegistrationQrEmail({ to, title, firstName, registrationId, conferenceType, qrPngBuffer }) {
  const tpl = registrationQrTemplate({ title, firstName, registrationId, conferenceType });

  return sendEmail({
    to,
    bcc: parseBccFromEnv(),
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    attachments: [
      {
        filename: `APSC2026-QR-${registrationId}.png`,
        content: qrPngBuffer,
        contentType: "image/png",
      },
    ],
  });
}

function parseGalaBccFromEnv() {
  // required by you: conference.nsasl@gmail.com
  const raw = process.env.GALA_DINNER_BCC_EMAILS || "conference.nsasl@gmail.com";
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

async function sendGalaDinnerTicketsEmail({ to, orderId, ticketCount, ticketIds, attachments }) {
  const ticketIdListHtml = (ticketIds || []).map((id) => `<li><b>${id}</b></li>`).join("");
  const tpl = galaDinnerTemplate({ orderId, ticketCount, ticketIds, ticketIdListHtml });

  return sendEmail({
    to,
    bcc: parseGalaBccFromEnv(),
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    attachments, // array of png files
  });
}

module.exports = {
  sendPasswordReset,
  sendAbstractSubmitted,
  sendRegistrationQrEmail,
  sendGalaDinnerTicketsEmail,
};
