const { baseLayout } = require("./base-layout");
const { renderString } = require("../render");

function abstractSubmittedTemplate(vars) {
  const subject = renderString("APSC 2026 Abstract Submitted ({{abstractId}})", vars);

  const body = baseLayout({
    title: "Abstract Submitted",
    bodyHtml: `
      <p>Hi {{firstName}},</p>
      <p>Your abstract has been successfully submitted for APSC 2026.</p>

      <p><b>Abstract ID:</b> {{abstractId}}</p>
      <p><b>Title:</b> {{abstractTitle}}</p>
      <p><b>Preferred presentation:</b> {{presentation}}</p>

      <p>You can log in to view or edit your abstract from your dashboard.</p>
    `,
    footerText: "APSC 2026 – Scientific Committee",
  });

  return {
    subject,
    html: renderString(body, vars),
    text:
      `Hi ${vars.firstName || ""}, your abstract was submitted.\n` +
      `Abstract ID: ${vars.abstractId}\nTitle: ${vars.abstractTitle}\n`,
  };
}

module.exports = { abstractSubmittedTemplate };
