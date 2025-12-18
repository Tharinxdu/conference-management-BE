const { sendEmail } = require("../utils/email/send-email");

const { passwordResetTemplate } = require("../utils/email/templates/password-reset");
const { abstractSubmittedTemplate } = require("../utils/email/templates/abstract-submitted");
const { registrationQrTemplate } = require("../utils/email/templates/registration-qr-template");

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

async function sendRegistrationQrEmail({ to, firstName, registrationId, conferenceType, qrPngBuffer }) {
  const tpl = registrationQrTemplate({ firstName, registrationId, conferenceType });

  return sendEmail({
    to,
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

module.exports = {
  sendPasswordReset,
  sendAbstractSubmitted,
  sendRegistrationQrEmail,
};
