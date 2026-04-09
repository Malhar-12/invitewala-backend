// ═══════════════════════════════════════════════════════════════
// Auth Routes — Firebase Phone OTP + our own session JWT
// Flow:
//   1. App → Firebase Phone Auth → user enters OTP → Firebase returns idToken
//   2. App → POST /auth/phone/verify { idToken }
//   3. Backend verifies idToken with Firebase Admin
//   4. Backend upserts user in Supabase (firebase_uid + phone)
//   5. Backend returns its own JWT + user object
//   6. App stores JWT in expo-secure-store and uses it for all future requests
// ═══════════════════════════════════════════════════════════════
const express = require("express");
const jwt = require("jsonwebtoken");
const { getSupabase } = require("../db/database");
const { verifyPhoneToken } = require("../lib/firebase");
const { audit } = require("../lib/audit");

const router = express.Router();

// ── Helpers ─────────────────────────────────────────────
function makeSessionToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "60d" });
}

function sanitize(str, maxLen = 200) {
  if (!str || typeof str !== "string") return "";
  return str.trim().slice(0, maxLen).replace(/[<>]/g, "");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

const ALLOWED_LANGS = new Set([
  "en", "hi", "mr", "ta", "te", "kn", "ml", "gu", "bn", "pa", "ur",
  "or", "ne", "si", "fr", "es", "de", "ar", "zh", "ja", "pt", "ru",
  "ko", "it", "tr", "th", "vi", "id",
]);

// ═══════════════════════════════════════════════════════════════
// POST /auth/guest
// Guest-only mode (pre-Firebase-Blaze). Creates a lightweight
// "guest" user row (no phone, no PII) and returns a session JWT.
// When Firebase is re-enabled, guests can be upgraded by calling
// /auth/phone/verify — we match by firebase_uid then.
// ═══════════════════════════════════════════════════════════════
router.post("/guest", async (req, res) => {
  try {
    const supabase = getSupabase();
    const guestTag = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const { data: user, error } = await supabase
      .from("users")
      .insert({
        firebase_uid: guestTag,
        phone: guestTag,
        tier: "free",
      })
      .select()
      .single();
    if (error) {
      console.error("guest insert error:", error.message);
      return res.status(500).json({ error: "Could not create guest" });
    }
    audit("guest_register", { userId: user.id, req });
    return res.json({
      token: makeSessionToken(user.id),
      user: { id: user.id, tier: user.tier, guest: true },
    });
  } catch (e) {
    console.error("guest error:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /auth/phone/verify
// Body: { idToken: string }      (Firebase phone-auth ID token)
// Returns: { token, user }
// ═══════════════════════════════════════════════════════════════
router.post("/phone/verify", async (req, res) => {
  try {
    const idToken = req.body.idToken;
    if (!idToken) return res.status(400).json({ error: "idToken required" });

    // Verify with Firebase
    let firebaseUser;
    try {
      firebaseUser = await verifyPhoneToken(idToken);
    } catch (e) {
      audit("phone_verify_fail", { req, metadata: { reason: e.message } });
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const supabase = getSupabase();

    // Look up existing user by firebase_uid
    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("firebase_uid", firebaseUser.uid)
      .maybeSingle();

    if (user && user.deleted_at) {
      // User had deleted their account — treat as new
      user = null;
    }

    if (!user) {
      // Create new user
      const { data: newUser, error } = await supabase
        .from("users")
        .insert({
          firebase_uid: firebaseUser.uid,
          phone: firebaseUser.phone,
          tier: "free",
        })
        .select()
        .single();

      if (error) {
        console.error("user insert error:", error.message);
        return res.status(500).json({ error: "Could not create account" });
      }
      user = newUser;
      audit("user_register", { userId: user.id, req });
    } else {
      // Update last_seen
      await supabase
        .from("users")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", user.id);
      audit("login_success", { userId: user.id, req });
    }

    return res.json({
      token: makeSessionToken(user.id),
      user: publicUser(user),
    });
  } catch (e) {
    console.error("phone/verify error:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /auth/me — current user
// ═══════════════════════════════════════════════════════════════
router.get("/me", requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", req.userId)
      .maybeSingle();

    if (error || !user || user.deleted_at) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({ user: publicUser(user) });
  } catch (e) {
    console.error("me error:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════
// PATCH /auth/me — update name, email (optional), language
// ═══════════════════════════════════════════════════════════════
router.patch("/me", requireAuth, async (req, res) => {
  try {
    const updates = {};

    if (req.body.name !== undefined) {
      const name = sanitize(req.body.name, 100);
      if (name.length < 1 || name.length > 100) {
        return res.status(400).json({ error: "Name must be 1-100 characters" });
      }
      updates.name = name;
    }

    if (req.body.email !== undefined) {
      const email = sanitize(req.body.email, 200).toLowerCase();
      if (email && !isValidEmail(email)) {
        return res.status(400).json({ error: "Invalid email format" });
      }
      updates.email = email || null;
      updates.email_verified = false;
    }

    if (req.body.language !== undefined) {
      const lang = sanitize(req.body.language, 5);
      if (!ALLOWED_LANGS.has(lang)) {
        return res.status(400).json({ error: "Unsupported language" });
      }
      updates.language = lang;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", req.userId)
      .select()
      .single();

    if (error) {
      // Most likely email unique violation
      if (error.code === "23505") {
        return res.status(409).json({ error: "Email already in use" });
      }
      console.error("me update error:", error.message);
      return res.status(500).json({ error: "Server error" });
    }

    audit("profile_update", { userId: req.userId, req, metadata: { fields: Object.keys(updates) } });
    return res.json({ user: publicUser(user) });
  } catch (e) {
    console.error("patch me error:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /auth/account — soft delete (Play Store requirement)
// Wipes invites (cascade), keeps user row with deleted_at set
// User can re-register with same phone — fresh account
// ═══════════════════════════════════════════════════════════════
router.delete("/account", requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();

    // Hard delete invites (cascade)
    await supabase.from("invites").delete().eq("user_id", req.userId);

    // Soft delete user — clear PII, set deleted_at
    const tombstone = `deleted_${Date.now()}_${req.userId.slice(0, 8)}`;
    const { error } = await supabase
      .from("users")
      .update({
        deleted_at: new Date().toISOString(),
        name: null,
        email: null,
        firebase_uid: tombstone, // free up the firebase_uid for re-registration
        phone: tombstone,         // free up the phone too
      })
      .eq("id", req.userId);

    if (error) {
      console.error("account delete error:", error.message);
      return res.status(500).json({ error: "Could not delete account" });
    }

    audit("account_delete", { userId: req.userId, req });
    return res.json({ success: true });
  } catch (e) {
    console.error("delete account error:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// ═══════════════════════════════════════════════════════════════
// Auth Middleware — verifies our own session JWT
// ═══════════════════════════════════════════════════════════════
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const token = header.slice(7);
    if (!token || token.length > 1000) {
      return res.status(401).json({ error: "Invalid token" });
    }
    const { userId } = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Optional auth — sets req.userId if token is valid, otherwise continues
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      const { userId } = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      req.userId = userId;
    } catch {
      // ignore — continue as guest
    }
  }
  next();
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    email: u.email,
    email_verified: u.email_verified,
    tier: u.tier,
    tier_expires_at: u.tier_expires_at,
    language: u.language,
    referral_code: u.referral_code,
    created_at: u.created_at,
  };
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.optionalAuth = optionalAuth;
