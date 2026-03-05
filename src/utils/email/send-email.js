const { getTransporter } = require("./transporter");
const { emailConfig } = require("../../config/email");
const { HttpError } = require("../http-error"); // adjust if your path differs

/**
 * sendEmail({
 *   to, subject, html, text,
 *   attachments: [{ filename, content, contentType }]
 * })
 */
async function sendEmail({ to, subject, html, text, attachments = [], replyTo, bcc } = {}) {
  try {
    if (!to) throw new HttpError(400, "Missing email recipient (to).");
    if (!subject) throw new HttpError(400, "Missing email subject.");
    if (!html && !text) throw new HttpError(400, "Email must contain html or text.");

    const transporter = getTransporter();

    const bccList =
      !bcc ? undefined : Array.isArray(bcc) ? bcc.filter(Boolean) : [bcc].filter(Boolean);

    const info = await transporter.sendMail({
      from: `"${emailConfig.from.name}" <${emailConfig.from.address}>`,
      to,
      ...(bccList?.length ? { bcc: bccList } : {}), 
      subject,
      html,
      text,
      replyTo: replyTo || emailConfig.replyTo,
      attachments,
    });

    return {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    };
  } catch (err) {
    console.error("sendEmail failed:", err?.message || err);
    throw err instanceof HttpError ? err : new HttpError(502, "Failed to send email.");
  }
}

module.exports = { sendEmail };
