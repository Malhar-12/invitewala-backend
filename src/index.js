// ═══════════════════════════════════════════════════════════════
// Nimantran API — main server entry
// ═══════════════════════════════════════════════════════════════
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { initDb } = require("./db/database");
const { initFirebase } = require("./lib/firebase");

const authRouter = require("./routes/auth");
const generateRouter = require("./routes/generate");
const invitesRouter = require("./routes/invites");
const rsvpRouter = require("./routes/rsvp");

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security headers ────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // not serving HTML
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ────────────────────────────────────────────────
// Mobile apps don't send Origin, so we allow no-origin requests.
// Browser RSVP page is also allowed (any origin) since it's public read.
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// ── Body parser with strict size limit ───────────────────
app.use(express.json({ limit: "100kb" }));

// ── Trust proxy (Render is behind one) ───────────────────
app.set("trust proxy", 1);

// ── Rate limits ─────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  message: { error: "Too many auth attempts. Try again later." },
});

const genLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  message: { error: "Too many generation requests. Wait a minute." },
});

app.use(globalLimiter);

// ── Routes ──────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok", version: "2.0.0" }));

app.use("/auth", authLimiter, authRouter);
app.use("/generate", genLimiter, generateRouter);
app.use("/invites", invitesRouter);
app.use("/rsvp", rsvpRouter);

// 404
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// Global error handler — never leak stack traces
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ── Boot ────────────────────────────────────────────────
(async () => {
  try {
    initFirebase();
    await initDb();
    app.listen(PORT, () => {
      console.log(`\n🚀 Nimantran API v2 running on port ${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/health\n`);
    });
  } catch (e) {
    console.error("Failed to start:", e);
    process.exit(1);
  }
})();
