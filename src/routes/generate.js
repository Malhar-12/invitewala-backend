const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { requireAuth } = require("./auth");

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /generate  — AI invitation text (requires auth)
router.post("/", requireAuth, async (req, res) => {
  try {
    const { occasionName, senderName, recipName, date, time, location, note, language } = req.body;

    if (!occasionName || !senderName)
      return res.status(400).json({ error: "occasionName and senderName required" });

    const prompt = `Write a warm ${occasionName} invitation in ${language || "English"}.
Sender: ${senderName}. Guest: ${recipName || "Guests"}.
${date ? `Date: ${date},` : ""} ${time ? `Time: ${time},` : ""} ${location ? `Venue: ${location}.` : ""}
${note ? `Special note: ${note}` : ""}
Write 3-4 warm, heartfelt sentences. Add 1-2 relevant emojis naturally. End with "— ${senderName}".
Return ONLY the invitation text, nothing else.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const text = (message.content?.[0]?.text || "").trim();
    res.json({ text });
  } catch (e) {
    console.error(e);
    // Return a graceful fallback instead of crashing the app
    const { senderName, recipName, occasionName } = req.body;
    const fallback = `Dear ${recipName || "Friend"},\n\nYou are warmly invited to celebrate ${occasionName} with ${senderName}. It would be a joy to have your presence with us on this special occasion. We look forward to a wonderful celebration together!\n\n— ${senderName}`;
    res.json({ text: fallback, fallback: true });
  }
});

module.exports = router;
