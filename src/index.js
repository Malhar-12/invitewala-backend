require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const { initDb } = require("./db/database");
const authRouter     = require("./routes/auth");
const generateRouter = require("./routes/generate");
const invitesRouter  = require("./routes/invites");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());

// Rate limiting — 60 req/min per IP
app.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));

// Tighter limit on AI generation (costs money)
const genLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { error: "Too many generation requests, please wait." } });

// ── Routes ──────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok", version: "1.0.0" }));
app.use("/auth",     authRouter);
app.use("/generate", genLimiter, generateRouter);
app.use("/invites",  invitesRouter);

// 404
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀 InviteWala API running on port ${PORT}`);
      console.log(`   Health: http://localhost:${PORT}/health\n`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
