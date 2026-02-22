const { baseLayout } = require("./base-layout");
const { renderString } = require("../render");

function registrationQrTemplate(vars) {
  const subject = renderString(
    "APSC 2026 – Registration Confirmation & Official Invitation ({{registrationId}})",
    vars
  );

  const body = baseLayout({
    title: "Registration Confirmation & Official Invitation",
    bodyHtml: `
      <p>Dear Participant,</p>

      <p>
        We are pleased to confirm that your registration for the Asia Pacific Stroke Conference (APSC) 2026 has been successfully completed.
      </p>

      <h3 style="margin: 18px 0 8px;">Conference Details</h3>
      <ul style="margin: 0 0 14px; padding-left: 18px;">
        <li><b>Event:</b> Asia Pacific Stroke Conference (APSC) 2026</li>
        <li><b>Dates:</b> 26th to 28th November 2026</li>
        <li><b>Venue:</b> Block 2 of Bandaranaike Memorial International Conference Hall (BMICH), Colombo, Sri Lanka</li>
        <li><b>Organised by:</b> National Stroke Association of Sri Lanka (NSASL)</li>
      </ul>

      <p><b>Registration ID:</b> {{registrationId}}</p>
      <p><b>Conference Type:</b> {{conferenceType}}</p>

      <p>
        Your personal QR code is attached to this email. Please ensure that you present this QR code at the conference entrance for registration verification and access.
      </p>

      <p>
        This email serves as an official confirmation of your registration for APSC 2026. Please note that the Organising Committee does not provide financial support, including travel, accommodation, or subsistence, unless explicitly stated in a separate written communication.
      </p>

      <p>
        For event details, programme updates, and announcements, please visit:<br/>
        <a href="https://www.apsc2026.lk" target="_blank" rel="noopener noreferrer">www.apsc2026.lk</a>
      </p>

      <p>
        If you require further assistance or verification, please contact the APSC 2026 Secretariat at:<br/>
        <a href="mailto:apsc2026.secretariat@gmail.com">apsc2026.secretariat@gmail.com</a>
      </p>

      <p>We look forward to welcoming you to APSC 2026.</p>

      <p style="margin-top: 18px;">
        Warm regards,<br/>
        <b>APSC 2026 Secretariat</b><br/>
        Asian Pacific Stroke Conference 2026<br/>
        National Stroke Association of Sri Lanka (NSASL)
      </p>
    `.replace(/\{\{.*?\}\}/g, (m) => m),
    footerText: "APSC 2026 Secretariat • National Stroke Association of Sri Lanka (NSASL)",
  });

  return {
    subject,
    html: renderString(body, vars),
    text:
      `Subject: APSC 2026 – Registration Confirmation & Official Invitation\n\n` +
      `Dear Participant,\n` +
      `We are pleased to confirm that your registration for the Asia Pacific Stroke Conference (APSC) 2026 has been successfully completed.\n\n` +
      `Conference Details\n` +
      `Event: Asia Pacific Stroke Conference (APSC) 2026\n` +
      `Dates: 26th to 28th November 2026\n` +
      `Venue: Block 2 of Bandaranaike Memorial International Conference Hall (BMICH), Colombo, Sri Lanka\n` +
      `Organised by: National Stroke Association of Sri Lanka (NSASL)\n\n` +
      `Registration ID: ${vars.registrationId || "N/A"}\n` +
      `Conference Type: ${vars.conferenceType || "N/A"}\n\n` +
      `Your personal QR code is attached to this email. Please present this QR code at the conference entrance for registration verification and access.\n\n` +
      `This email serves as an official confirmation of your registration for APSC 2026. Please note that the Organising Committee does not provide financial support, including travel, accommodation, or subsistence, unless explicitly stated in a separate written communication.\n\n` +
      `For event details, programme updates, and announcements, please visit: www.apsc2026.lk\n` +
      `If you require further assistance or verification, please contact the APSC 2026 Secretariat at: apsc2026.secretariat@gmail.com\n\n` +
      `We look forward to welcoming you to APSC 2026.\n\n` +
      `Warm regards,\n` +
      `APSC 2026 Secretariat\n` +
      `Asian Pacific Stroke Conference 2026\n` +
      `National Stroke Association of Sri Lanka (NSASL)\n`,
  };
}


module.exports = { registrationQrTemplate };
