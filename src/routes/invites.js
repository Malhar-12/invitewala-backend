const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { requireAuth } = require("./auth");
const { getDb } = require("../db/database");

const router = express.Router();

// GET /invites — list user's saved invites
router.get("/", requireAuth, (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, occasion_id, occasion_name, sender_name, recip_name,
              event_date, event_time, location, note, language, template_id,
              generated_text, created_at
       FROM invites WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`
    )
    .all(req.userId);
  res.json({ invites: rows });
});

// POST /invites — save a new invite
router.post("/", requireAuth, (req, res) => {
  try {
    const {
      occasionId, occasionName, senderName, recipName,
      eventDate, eventTime, location, note,
      language, templateId, generatedText,
    } = req.body;

    if (!occasionId || !senderName)
      return res.status(400).json({ error: "occasionId and senderName required" });

    const db = getDb();
    const id = uuidv4();
    db.prepare(`
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
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /invites/:id
router.delete("/:id", requireAuth, (req, res) => {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM invites WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.userId);
  if (result.changes === 0)
    return res.status(404).json({ error: "Invite not found" });
  res.json({ success: true });
});

module.exports = router;
