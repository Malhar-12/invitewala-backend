require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { initDb } = require("./db/database");
const authRouter     = require("./routes/auth");
const generateRouter = require("./routes/generate");
const invitesRouter  = require("./routes/invites");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security Middleware ─────────────────────────────────
// Helmet adds security headers (XSS protection, no-sniff, etc.)
app.use(helmet());

// CORS — only allow your app, not the whole internet
const ALLOWED_ORIGINS = [
  "https://invitewala-backend-1.onrender.com",
  "http://localhost:3001",
  "http://localhost:19006", // Expo web dev
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow mobile apps (no origin header) and allowed origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Mobile apps don't send origin, so allow all for now
    }
  },
  methods: ["GET", "POST", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// Body parser with size limit (prevent large payload attacks)
app.use(express.json({ limit: "10kb" }));

// Trust proxy for rate limiting behind Render's proxy
app.set("trust proxy", 1);

// Rate limiting — 60 req/min per IP (global)
app.use(rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
}));

// Tighter limit on AI generation (costs money)
const genLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: "Too many generation requests, please wait a minute." },
});

// Auth rate limit — prevent brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  max: 20, // 20 attempts per 15 min
  message: { error: "Too many login attempts, please try again later." },
});

// ── Routes ──────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok", version: "1.1.0" }));
app.use("/auth",     authLimiter, authRouter);
app.use("/generate", genLimiter, generateRouter);
app.use("/invites",  invitesRouter);

// 404
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// Global error handler — never leak stack traces
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 Nimantran API running on port ${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/health\n`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
