const { baseLayout } = require("./base-layout");
const { renderString } = require("../render");

function galaDinnerTemplate(vars) {
  const subject = renderString("APSC 2026 – Gala Dinner Coupons ({{orderId}})", vars);

  const body = baseLayout({
    title: "Gala Dinner Coupons",
    bodyHtml: `
      <p>Dear Participant,</p>

      <p>
        You have been successfully registered to receive <b>{{ticketCount}}</b> coupon(s) for the Gala Dinner,
        which will be held at the <b>Sapphire Banquet Hall</b> at <b>BMICH</b> (the venue for APSC 2026)
        following the Welcome Ceremony on <b>26th November 2026</b>.
      </p>

      <p>
        Please present the QR code(s) attached (either on your mobile device or as a printed copy) at the registration desk
        at the conference venue to obtain your Gala Dinner coupons.
      </p>

      <h3 style="margin: 16px 0 8px;">Ticket IDs</h3>
      <p style="margin: 0 0 10px;">
        If a QR code cannot be scanned, the registration desk can verify using the Ticket ID(s) below:
      </p>
      <ul style="margin: 0 0 14px; padding-left: 18px;">
        {{ticketIdListHtml}}
      </ul>

      <p>Thank you</p>
    `.replace(/\{\{.*?\}\}/g, (m) => m),
    footerText: "APSC 2026 Secretariat • National Stroke Association of Sri Lanka (NSASL)",
  });

  return {
    subject,
    html: renderString(body, vars),
    text:
      `Dear Participant,\n\n` +
      `You have been successfully registered to receive ${vars.ticketCount} coupon(s) for the Gala Dinner, which will be held at the Sapphire Banquet Hall at BMICH (the venue for APSC 2026) following the Welcome Ceremony on 26th November 2026.\n\n` +
      `Please present the QR code(s) attached at the registration desk at the conference venue to obtain your Gala Dinner coupons.\n\n` +
      `Ticket IDs:\n` +
      `${(vars.ticketIds || []).map((id) => `- ${id}`).join("\n")}\n\n` +
      `Thank you\n`,
  };
}

module.exports = { galaDinnerTemplate };