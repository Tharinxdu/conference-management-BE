const nodemailer = require("nodemailer");
const { emailConfig } = require("../../config/email");

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: emailConfig.auth,

    pool: true,
    maxConnections: 3,
    maxMessages: 100,

    connectionTimeout: emailConfig.connectionTimeout,
    greetingTimeout: emailConfig.greetingTimeout,
    socketTimeout: emailConfig.socketTimeout,

    tls: {
      // In production, DO NOT set rejectUnauthorized=false.
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
  });

  return transporter;
}

module.exports = { getTransporter };
