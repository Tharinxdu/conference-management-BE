const { baseLayout } = require("./base-layout");
const { renderString } = require("../render");

function passwordResetTemplate(vars) {
  const subject = "Reset your password (APSC 2026)";

  const body = baseLayout({
    title: "Password Reset",
    bodyHtml: `
      <p>We received a request to reset your password.</p>
      <p>Click the link below to reset it:</p>
      <p><a href="{{resetUrl}}">{{resetUrl}}</a></p>
      <p>This link will expire in {{expiresMinutes}} minutes.</p>
      <p>If you didn't request this, ignore this email.</p>
    `,
    footerText: "APSC 2026",
  });

  return {
    subject,
    html: renderString(body, vars),
    text: `Reset your password: ${vars.resetUrl} (expires in ${vars.expiresMinutes} minutes)`,
  };
}

module.exports = { passwordResetTemplate };
