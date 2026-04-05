const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { getDb } = require("../db/database");

const router = express.Router();

function makeToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitize(str, maxLen = 200) {
  if (!str || typeof str !== "string") return "";
  return str.trim().slice(0, maxLen).replace(/[<>]/g, "");
}

// POST /auth/register
router.post("/register", async (req, res) => {
  try {
    const name = sanitize(req.body.name, 100);
    const email = sanitize(req.body.email, 200).toLowerCase();
    const password = req.body.password;

    if (!name || !email || !password)
      return res.status(400).json({ error: "Name, email and password required" });
    if (!isValidEmail(email))
      return res.status(400).json({ error: "Invalid email format" });
    if (name.length < 2 || name.length > 100)
      return res.status(400).json({ error: "Name must be 2-100 characters" });
    if (typeof password !== "string" || password.length < 6 || password.length > 128)
      return res.status(400).json({ error: "Password must be 6-128 characters" });

    const db = getDb();
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) return res.status(409).json({ error: "Email already registered" });

    const hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    await db.prepare("INSERT INTO users (id, name, email, password) VALUES (?, ?, ?, ?)").run(id, name, email, hash);

    res.json({ token: makeToken(id), user: { id, name, email } });
  } catch (e) {
    console.error("Register error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /auth/login
router.post("/login", async (req, res) => {
  try {
    const email = sanitize(req.body.email, 200).toLowerCase();
    const password = req.body.password;

    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });
    if (!isValidEmail(email))
      return res.status(400).json({ error: "Invalid email format" });

    const db = getDb();
    const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    res.json({
      token: makeToken(user.id),
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (e) {
    console.error("Login error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /auth/me
router.get("/me", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const user = await db.prepare("SELECT id, name, email, created_at FROM users WHERE id = ?").get(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user });
  } catch (e) {
    console.error("Get me error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Auth Middleware
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer "))
    return res.status(401).json({ error: "Unauthorized" });
  try {
    const token = header.slice(7);
    if (!token || token.length > 500)
      return res.status(401).json({ error: "Invalid token" });
    const { userId } = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
