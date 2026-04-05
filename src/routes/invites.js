const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { requireAuth } = require("./auth");
const { getDb } = require("../db/database");

const router = express.Router();

function sanitize(str, maxLen = 200) {
  if (!str || typeof str !== "string") return "";
  return str.trim().slice(0, maxLen).replace(/[<>]/g, "");
}

// GET /invites — list user's saved invites
router.get("/", requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const rows = await db
      .prepare(
        `SELECT id, occasion_id, occasion_name, sender_name, recip_name,
                event_date, event_time, location, note, language, template_id,
                generated_text, created_at
         FROM invites WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
      )
      .all(req.userId);
    res.json({ invites: rows || [] });
  } catch (e) {
    console.error("Get invites error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /invites — save a new invite
router.post("/", requireAuth, async (req, res) => {
  try {
    const occasionId = sanitize(req.body.occasionId, 50);
    const occasionName = sanitize(req.body.occasionName, 100);
    const senderName = sanitize(req.body.senderName, 100);
    const recipName = sanitize(req.body.recipName, 100);
    const eventDate = sanitize(req.body.eventDate, 30);
    const eventTime = sanitize(req.body.eventTime, 20);
    const location = sanitize(req.body.location, 200);
    const note = sanitize(req.body.note, 500);
    const language = sanitize(req.body.language, 10);
    const templateId = sanitize(req.body.templateId, 20);
    const generatedText = sanitize(req.body.generatedText, 2000);

    if (!occasionId || !senderName)
      return res.status(400).json({ error: "occasionId and senderName required" });

    const db = getDb();

    // Limit invites per user
    const count = await db.prepare("SELECT COUNT(*) as cnt FROM invites WHERE user_id = ?").get(req.userId);
    if (count && count.cnt >= 500) {
      return res.status(429).json({ error: "Maximum 500 saved invites reached." });
    }

    const id = uuidv4();
    await db.prepare(`
      INSERT INTO invites
        (id, user_id, occasion_id, occasion_name, sender_name, recip_name,
         event_date, event_time, location, note, language, template_id, generated_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, req.userId, occasionId, occasionName, senderName,
      recipName || null, eventDate || null, eventTime || null,
      location || null, note || null,
      language || "en", templateId || "luxe", generatedText || null
    );

    res.status(201).json({ id });
  } catch (e) {
    console.error("Save invite error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /invites/:id
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const id = sanitize(req.params.id, 50);
    if (!id) return res.status(400).json({ error: "Invalid invite ID" });

    const db = getDb();
    const result = await db
      .prepare("DELETE FROM invites WHERE id = ? AND user_id = ?")
      .run(id, req.userId);
    if (result.changes === 0)
      return res.status(404).json({ error: "Invite not found" });
    res.json({ success: true });
  } catch (e) {
    console.error("Delete invite error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
