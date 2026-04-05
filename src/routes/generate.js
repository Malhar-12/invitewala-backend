const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { requireAuth } = require("./auth");

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Input sanitization ──────────────────────────────────
function sanitize(str, maxLen = 200) {
  if (!str || typeof str !== "string") return "";
  // Remove control characters, excessive whitespace, and suspicious patterns
  return str
    .trim()
    .slice(0, maxLen)
    .replace(/[<>]/g, "") // Strip HTML
    .replace(/\n{3,}/g, "\n\n") // Max 2 newlines
    .replace(/ignore (previous|above|all) (instructions|prompts?)/gi, "") // Anti-injection
    .replace(/system\s*prompt/gi, "") // Anti-injection
    .replace(/you are now/gi, "") // Anti-injection
    .replace(/pretend to be/gi, "") // Anti-injection
    .replace(/act as/gi, ""); // Anti-injection
}

// Allowed languages — prevent injection via language field
const ALLOWED_LANGUAGES = new Set([
  "English", "Hindi", "Marathi", "Tamil", "Telugu", "Kannada", "Malayalam",
  "Gujarati", "Bengali", "Punjabi", "Urdu", "Odia", "Nepali", "Sinhala",
  "French", "Spanish", "German", "Arabic", "Chinese", "Japanese",
  "Portuguese", "Russian", "Korean", "Italian", "Turkish", "Thai",
  "Vietnamese", "Indonesian",
]);

// POST /generate — AI invitation text (requires auth)
router.post("/", requireAuth, async (req, res) => {
  try {
    const occasionName = sanitize(req.body.occasionName, 100);
    const senderName = sanitize(req.body.senderName, 100);
    const recipName = sanitize(req.body.recipName, 100);
    const date = sanitize(req.body.date, 30);
    const time = sanitize(req.body.time, 20);
    const location = sanitize(req.body.location, 200);
    const note = sanitize(req.body.note, 300);
    const promptHint = sanitize(req.body.promptHint, 500);

    // Validate language against whitelist
    const rawLang = sanitize(req.body.language, 50);
    const lang = ALLOWED_LANGUAGES.has(rawLang) ? rawLang : "English";

    if (!occasionName || !senderName)
      return res.status(400).json({ error: "occasionName and senderName required" });

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

    // Post-process: strip any greeting/closing the AI might have added
    text = text.replace(/^(Dear\s+[^,\n]+,?\s*\n*|प्रिय\s+[^,\n]+,?\s*\n*|প্রিয়\s+[^,\n]+,?\s*\n*|ప్రియమైన\s+[^,\n]+,?\s*\n*|அன்புள்ள\s+[^,\n]+,?\s*\n*|ಪ್ರಿಯ\s+[^,\n]+,?\s*\n*|પ્રિય\s+[^,\n]+,?\s*\n*|ਪਿਆਰੇ\s+[^,\n]+,?\s*\n*|عزیز\s+[^,\n]+,?\s*\n*|പ്രിയ\s+[^,\n]+,?\s*\n*)/i, "").trim();
    text = text.replace(/\n*(—\s*.+|With\s+(love|warm|best|regards|blessings)[^]*?$|Warm(ly)?\s+regards[^]*?$|आपला\s+.+$|आपली\s+.+$|सादर[,\s]*\n*.+$|आपला\/आपली[^]*?$|With\s+\w+,?\s*\n*.+$)/im, "").trim();

    // Safety: ensure response isn't too long (max 1000 chars)
    if (text.length > 1000) text = text.slice(0, 1000);

    res.json({ text });
  } catch (e) {
    console.error("Generate error:", e.message);
    const { occasionName } = req.body;
    const safeName = sanitize(occasionName, 100) || "the event";
    const fallback = `You are all warmly invited to celebrate ${safeName} with us! It would be a joy to have everyone's presence on this special occasion. Let's come together and make this celebration truly memorable! ✨`;
    res.json({ text: fallback, fallback: true });
  }
});

module.exports = router;
