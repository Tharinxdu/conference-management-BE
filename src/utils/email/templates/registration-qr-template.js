const { baseLayout } = require("./base-layout");
const { renderString } = require("../render");

function registrationQrTemplate(vars) {
  const subject = renderString("APSC 2026 Registration QR ({{registrationId}})", vars);

  const body = baseLayout({
    title: "Your QR Code for Check-in",
    bodyHtml: `
      <p>Hi {{firstName}},</p>
      <p>Your registration has been confirmed.</p>

      <p><b>Registration ID:</b> {{registrationId}}</p>
      <p>Please find your QR code attached to this email. Keep it ready for conference day check-in.</p>

      <p><b>Conference Type:</b> {{conferenceType}}</p>
    `.replace(/\{\{.*?\}\}/g, (m) => m),
    footerText: "APSC 2026 – Registration Desk",
  });

  return {
    subject,
    html: renderString(body, vars),
    text:
      `Hi ${vars.firstName || ""}, your registration is confirmed.\n` +
      `Registration ID: ${vars.registrationId}\n` +
      `Conference Type: ${vars.conferenceType}\n` +
      `Your QR code is attached to this email.\n`,
  };
}

module.exports = { registrationQrTemplate };
