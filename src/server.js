require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const path = require("path");

const { connectDB } = require("./config/db");

const authRoutes = require("./routes/auth-routes");
const registrationRoutes = require("./routes/registration-routes");
const paymentRoutes = require("./routes/payment-routes");
const profileRoutes = require("./routes/profile-routes");
const abstractRoutes = require("./routes/abstract-routes");
const adminAbstractRoutes = require("./routes/admin-abstract-routes");
const checkinRoutes = require("./routes/checkin-routes");
const adminRoutes = require("./routes/admin-routes");


const { HttpError } = require("./utils/http-error"); // adjust if your path is different

const PORT = process.env.PORT || 3000;

function getAllowedOrigins() {
  // Allow multiple origins via comma-separated env:
  // CLIENT_ORIGIN=http://localhost:4200,http://localhost:5173
  const raw = process.env.CLIENT_ORIGIN || "http://localhost:4200";
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

async function main() {
  await connectDB();

  const app = express();

  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  /**
   * Important when using secure cookies behind a proxy (Render, Nginx, etc.)
   * - required if you ever set cookie: { secure: true }
   */
  app.set("trust proxy", 1);

  /**
   * CORS for cookie-based auth:
   * - credentials:true so browser sends cookies
   * - origin must be explicit (not "*")
   */
  const allowedOrigins = getAllowedOrigins();
  app.use(
    cors({
      origin: function (origin, callback) {
        // Allow non-browser tools (Postman) where origin is undefined
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) return callback(null, true);

        return callback(new HttpError(403, `CORS blocked for origin: ${origin}`));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // Body parser + cookies
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Health check (public)
  app.get("/health", (req, res) => res.json({ ok: true }));

  /**
   * Routes:
   * - /api/auth -> public login/register endpoints + protected /me etc (inside routes)
   * - /api/registrations -> mixed (create public, admin-only list/edit/delete in router)
   * - /api/payments -> mixed (initiate public, callback public, admin status optional)
   *
   * ⚠️ Don't apply requireAuth globally here, because some endpoints must stay public.
   * Put auth middleware inside each router on the specific routes that need it.
   */
  app.use("/api/auth", authRoutes);
  app.use("/api/registrations", registrationRoutes);
  app.use("/api/payments", paymentRoutes);
  app.use("/api/profile", profileRoutes);
  app.use("/api/abstracts", abstractRoutes);
  app.use("/api/admin/abstracts", adminAbstractRoutes);
  app.use("/api/checkin", checkinRoutes);
  app.use("/api/admin", adminRoutes);


  // 404
  app.use((req, res) => res.status(404).json({ message: "Not found" }));

  /**
   * Error handler (HttpError aware)
   * - Always return generic message if it's 500
   * - Include details only when provided
   */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const statusCode = err?.statusCode || 500;

    if (statusCode >= 500) {
      console.error("❌ Server error:", err);
      return res.status(500).json({ message: "Server error" });
    }

    return res.status(statusCode).json({
      message: err?.message || "Request failed",
      ...(err?.details ? { details: err.details } : {}),
    });
  });

  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
}

main().catch((err) => {
  console.error("❌ Failed to start:", err);
  process.exit(1);
});
