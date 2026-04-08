// ═══════════════════════════════════════════════════════════════
// Public RSVP Routes — no auth required
// Lets invitees view an invite by short_code and respond
// ═══════════════════════════════════════════════════════════════
const express = require("express");
const { getSupabase } = require("../db/database");

const router = express.Router();

function sanitize(str, maxLen = 200) {
  if (!str || typeof str !== "string") return "";
  return str.trim().slice(0, maxLen).replace(/[<>]/g, "");
}

// GET /rsvp/:shortCode — view invite
router.get("/:shortCode", async (req, res) => {
  try {
    const code = sanitize(req.params.shortCode, 12);
    if (!code) return res.status(400).json({ error: "Invalid code" });

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("invites")
      .select("id, occasion_name, sender_name, event_date, event_time, location, note, language, template_id, generated_text, photo_url, family_members, tithi, view_count, rsvp_yes, rsvp_no, rsvp_maybe")
      .eq("short_code", code)
      .maybeSingle();

    if (error || !data) return res.status(404).json({ error: "Invite not found" });

    // Increment view count (fire and forget)
    supabase
      .from("invites")
      .update({ view_count: (data.view_count || 0) + 1 })
      .eq("short_code", code)
      .then(() => {});

    return res.json({ invite: data });
  } catch (e) {
    console.error("rsvp get error:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /rsvp/:shortCode — respond yes/no/maybe
router.post("/:shortCode", async (req, res) => {
  try {
    const code = sanitize(req.params.shortCode, 12);
    const guestName = sanitize(req.body.guestName, 100);
    const response = sanitize(req.body.response, 10);
    const message = sanitize(req.body.message, 300);

    if (!code || !guestName || !["yes", "no", "maybe"].includes(response)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const supabase = getSupabase();

    const { data: invite } = await supabase
      .from("invites")
      .select("id, rsvp_yes, rsvp_no, rsvp_maybe")
      .eq("short_code", code)
      .maybeSingle();
    if (!invite) return res.status(404).json({ error: "Invite not found" });

    const { error: insertErr } = await supabase.from("rsvps").insert({
      invite_id: invite.id,
      guest_name: guestName,
      response,
      message: message || null,
    });
    if (insertErr) {
      console.error("rsvp insert error:", insertErr.message);
      return res.status(500).json({ error: "Server error" });
    }

    // Bump counter
    const counters = {
      rsvp_yes: invite.rsvp_yes || 0,
      rsvp_no: invite.rsvp_no || 0,
      rsvp_maybe: invite.rsvp_maybe || 0,
    };
    counters[`rsvp_${response}`] += 1;
    await supabase.from("invites").update(counters).eq("id", invite.id);

    return res.json({ success: true });
  } catch (e) {
    console.error("rsvp post error:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
