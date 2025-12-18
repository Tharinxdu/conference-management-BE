function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const emailConfig = {
  host: mustEnv("SMTP_HOST"),
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || "false") === "true", // true for 465
  auth: {
    user: mustEnv("SMTP_USER"),
    pass: mustEnv("SMTP_PASS"),
  },

  from: {
    name: process.env.EMAIL_FROM_NAME || "APSC 2026",
    address: mustEnv("EMAIL_FROM_ADDRESS"),
  },

  replyTo: process.env.EMAIL_REPLY_TO || undefined,

  // timeouts (ms)
  connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT || 10000),
  greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT || 10000),
  socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 20000),
};

module.exports = { emailConfig };
