// ═══════════════════════════════════════════════════════════════
// Invite Routes — CRUD for saved invitations
// ═══════════════════════════════════════════════════════════════
const express = require("express");
const { requireAuth } = require("./auth");
const { getSupabase } = require("../db/database");

const router = express.Router();

const MAX_INVITES_PER_USER = 500;

const ALLOWED_TONES = new Set([
  "heartfelt", "formal", "poetic", "traditional", "festive", "funny",
]);

function sanitize(str, maxLen = 200) {
  if (str === undefined || str === null) return null;
  if (typeof str !== "string") return null;
  const v = str.trim().slice(0, maxLen).replace(/[<>]/g, "");
  return v || null;
}

// ═══ GET /invites — list user's saved invites ════════════════════
router.get("/", requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("invites")
      .select(
        "id, occasion_id, occasion_name, sender_name, recip_name, event_date, event_time, location, note, language, template_id, generated_text, photo_url, music_id, font_id, family_members, tithi, tone, short_code, view_count, rsvp_yes, rsvp_no, rsvp_maybe, created_at"
      )
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("get invites error:", error.message);
      return res.status(500).json({ error: "Server error" });
    }
    return res.json({ invites: data || [] });
  } catch (e) {
    console.error("get invites exception:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// ═══ POST /invites — save a new invite ══════════════════════════
router.post("/", requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();

    // Quota check
    const { count, error: countErr } = await supabase
      .from("invites")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.userId);
    if (countErr) {
      console.error("count error:", countErr.message);
      return res.status(500).json({ error: "Server error" });
    }
    if ((count || 0) >= MAX_INVITES_PER_USER) {
      return res.status(429).json({ error: `Maximum ${MAX_INVITES_PER_USER} saved invites reached.` });
    }

    const tone = sanitize(req.body.tone, 30);

    const payload = {
      user_id:        req.userId,
      occasion_id:    sanitize(req.body.occasionId, 50),
      occasion_name:  sanitize(req.body.occasionName, 100),
      sender_name:    sanitize(req.body.senderName, 100),
      recip_name:     sanitize(req.body.recipName, 100),
      event_date:     sanitize(req.body.eventDate, 30),
      event_time:     sanitize(req.body.eventTime, 20),
      location:       sanitize(req.body.location, 200),
      note:           sanitize(req.body.note, 500),
      language:       sanitize(req.body.language, 10) || "en",
      template_id:    sanitize(req.body.templateId, 30) || "luxe",
      generated_text: sanitize(req.body.generatedText, 2000),
      photo_url:      sanitize(req.body.photoUrl, 500),
      music_id:       sanitize(req.body.musicId, 50),
      font_id:        sanitize(req.body.fontId, 50) || "default",
      family_members: sanitize(req.body.familyMembers, 500),
      tithi:          sanitize(req.body.tithi, 100),
      tone:           tone && ALLOWED_TONES.has(tone) ? tone : "heartfelt",
    };

    if (!payload.occasion_id || !payload.sender_name) {
      return res.status(400).json({ error: "occasionId and senderName required" });
    }

    const { data, error } = await supabase
      .from("invites")
      .insert(payload)
      .select("id, short_code")
      .single();

    if (error) {
      console.error("insert invite error:", error.message);
      return res.status(500).json({ error: "Server error" });
    }
    return res.status(201).json({ id: data.id, shortCode: data.short_code });
  } catch (e) {
    console.error("save invite exception:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// ═══ DELETE /invites/:id ═════════════════════════════════════════
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const id = sanitize(req.params.id, 50);
    if (!id) return res.status(400).json({ error: "Invalid invite ID" });

    const supabase = getSupabase();
    const { error, count } = await supabase
      .from("invites")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("user_id", req.userId);

    if (error) {
      console.error("delete invite error:", error.message);
      return res.status(500).json({ error: "Server error" });
    }
    if (!count) return res.status(404).json({ error: "Invite not found" });
    return res.json({ success: true });
  } catch (e) {
    console.error("delete invite exception:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
