const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { requireAuth } = require("./auth");

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /generate  — AI invitation text (requires auth)
router.post("/", requireAuth, async (req, res) => {
  try {
    const { occasionName, senderName, recipName, date, time, location, note, language, promptHint } = req.body;

    if (!occasionName || !senderName)
      return res.status(400).json({ error: "occasionName and senderName required" });

    const lang = language || "English";
    const style = promptHint || `Write a warm ${occasionName} invitation.`;

    const prompt = `${style}
The ENTIRE invitation MUST be written in ${lang}. Every word, every sentence — everything in ${lang}. Do NOT mix languages.
This is a GROUP invitation — it will be sent to MANY people, not just one person.

CRITICAL RULES:
1. Write ONLY the body text (3-4 heartfelt sentences).
2. Do NOT start with any greeting like "Dear...", "प्रिय...", "প্রিয়...", etc. — the app adds the greeting automatically.
3. Do NOT end with sender name, closing line like "— ${senderName}", "Warm regards", "आपला/आपली", "सादर", "With love" etc. — the app adds sender name automatically.
4. Do NOT use any gendered words for the sender/host. No आपला/आपली, no his/her. Keep it completely gender-neutral.
5. Use group-friendly language — "you all", "everyone", "सभी", "सर्वांना" etc. Never address a single person.
6. Add 1-2 relevant emojis naturally within the text.
7. Do not include jokes, sarcasm or inappropriate lines. Keep it natural, warm and meaningful.

Context — Sender: ${senderName}. ${date ? `Date: ${date}.` : ""} ${time ? `Time: ${time}.` : ""} ${location ? `Venue: ${location}.` : ""}
${note ? `Special note: ${note}` : ""}

Return ONLY the invitation body text in ${lang}. No greeting, no closing, no sender name. Just the beautiful invitation content.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    let text = (message.content?.[0]?.text || "").trim();

    // Post-process: strip any greeting/closing the AI might have added despite instructions
    // Remove common greetings at the start
    text = text.replace(/^(Dear\s+[^,\n]+,?\s*\n*|प्रिय\s+[^,\n]+,?\s*\n*|প্রিয়\s+[^,\n]+,?\s*\n*|ప్రియమైన\s+[^,\n]+,?\s*\n*|அன்புள்ள\s+[^,\n]+,?\s*\n*|ಪ್ರಿಯ\s+[^,\n]+,?\s*\n*|પ્રિય\s+[^,\n]+,?\s*\n*|ਪਿਆਰੇ\s+[^,\n]+,?\s*\n*|عزیز\s+[^,\n]+,?\s*\n*|പ്രിയ\s+[^,\n]+,?\s*\n*)/i, "").trim();

    // Remove common closings at the end
    text = text.replace(/\n*(—\s*.+|With\s+(love|warm|best|regards|blessings)[^]*?$|Warm(ly)?\s+regards[^]*?$|आपला\s+.+$|आपली\s+.+$|सादर[,\s]*\n*.+$|आपला\/आपली[^]*?$|With\s+\w+,?\s*\n*.+$)/im, "").trim();

    res.json({ text });
  } catch (e) {
    console.error(e);
    // Return a graceful fallback instead of crashing the app
    const { occasionName } = req.body;
    const fallback = `You are all warmly invited to celebrate ${occasionName} with us! It would be a joy to have everyone's presence on this special occasion. Let's come together and make this celebration truly memorable! ✨`;
    res.json({ text: fallback, fallback: true });
  }
});

module.exports = router;
