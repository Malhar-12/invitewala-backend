// ═══════════════════════════════════════════════════════════════
// AI Generate Route — Claude writes invitation body text
// Auth required + per-user daily quota + prompt injection guard
// ═══════════════════════════════════════════════════════════════
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { requireAuth } = require("./auth");
const { getSupabase } = require("../db/database");
const { audit } = require("../lib/audit");

const router = express.Router();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Per-user daily quota by tier ────────────────────────
const DAILY_QUOTA = {
  free:    20,
  pro:     500,
  wedding: 500,
};

// ── Input sanitization ──────────────────────────────────
function sanitize(str, maxLen = 200) {
  if (!str || typeof str !== "string") return "";
  return str
    .trim()
    .slice(0, maxLen)
    .replace(/[<>]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ignore\s+(previous|above|all)\s+(instructions?|prompts?)/gi, "")
    .replace(/system\s*prompt/gi, "")
    .replace(/you are now/gi, "")
    .replace(/pretend\s+to\s+be/gi, "")
    .replace(/act\s+as/gi, "")
    .replace(/\bdeveloper\s+mode\b/gi, "")
    .replace(/\bjailbreak\b/gi, "");
}

const ALLOWED_LANGUAGES = new Set([
  "English", "Hindi", "Marathi", "Tamil", "Telugu", "Kannada", "Malayalam",
  "Gujarati", "Bengali", "Punjabi", "Urdu", "Odia", "Nepali", "Sinhala",
  "French", "Spanish", "German", "Arabic", "Chinese", "Japanese",
  "Portuguese", "Russian", "Korean", "Italian", "Turkish", "Thai",
  "Vietnamese", "Indonesian",
]);

const ALLOWED_TONES = new Set([
  "heartfelt", "formal", "poetic", "traditional", "festive", "funny",
]);

const TONE_INSTRUCTIONS = {
  heartfelt:   "warm, sincere, emotional — make readers feel loved",
  formal:      "respectful, dignified, professional — for business or official events",
  poetic:      "use rhythmic language, light couplets if natural in the language, but keep it short",
  traditional: "use classic, time-honored phrasing rooted in cultural tradition",
  festive:     "joyful, celebratory, energetic — for fun parties and festivals",
  funny:       "lighthearted, playful, witty — never crude or offensive",
};

// ── Quota helpers ───────────────────────────────────────
async function checkAndIncrementQuota(userId) {
  const supabase = getSupabase();

  // Get user tier
  const { data: user } = await supabase
    .from("users")
    .select("tier, tier_expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (!user) return { allowed: false, reason: "user_missing" };

  let tier = user.tier || "free";
  if (tier !== "free" && user.tier_expires_at && new Date(user.tier_expires_at) < new Date()) {
    tier = "free";
  }
  const limit = DAILY_QUOTA[tier] || DAILY_QUOTA.free;

  // Get today's count
  const today = new Date().toISOString().slice(0, 10);
  const { data: row } = await supabase
    .from("gen_quota")
    .select("count")
    .eq("user_id", userId)
    .eq("day", today)
    .maybeSingle();

  const used = row ? row.count : 0;
  if (used >= limit) {
    return { allowed: false, reason: "quota_exceeded", used, limit, tier };
  }

  // Increment (upsert)
  await supabase
    .from("gen_quota")
    .upsert(
      { user_id: userId, day: today, count: used + 1 },
      { onConflict: "user_id,day" }
    );

  return { allowed: true, used: used + 1, limit, tier };
}

// ═══════════════════════════════════════════════════════════════
// POST /generate — write a beautiful invitation body
// ═══════════════════════════════════════════════════════════════
router.post("/", requireAuth, async (req, res) => {
  try {
    // Quota
    const quota = await checkAndIncrementQuota(req.userId);
    if (!quota.allowed) {
      audit("gen_quota_hit", { userId: req.userId, req, metadata: quota });
      return res.status(429).json({
        error: "Daily limit reached",
        message: `You've used your ${quota.limit} daily generations. Upgrade to Pro for unlimited.`,
        used: quota.used,
        limit: quota.limit,
        tier: quota.tier,
      });
    }

    // Inputs
    const occasionName = sanitize(req.body.occasionName, 100);
    const senderName = sanitize(req.body.senderName, 100);
    const recipName = sanitize(req.body.recipName, 100);
    const date = sanitize(req.body.date, 30);
    const time = sanitize(req.body.time, 20);
    const location = sanitize(req.body.location, 200);
    const note = sanitize(req.body.note, 300);
    const promptHint = sanitize(req.body.promptHint, 500);
    const familyMembers = sanitize(req.body.familyMembers, 300);

    const rawLang = sanitize(req.body.language, 50);
    const lang = ALLOWED_LANGUAGES.has(rawLang) ? rawLang : "English";

    const rawTone = sanitize(req.body.tone, 30).toLowerCase();
    const tone = ALLOWED_TONES.has(rawTone) ? rawTone : "heartfelt";
    const toneDesc = TONE_INSTRUCTIONS[tone];

    if (!occasionName || !senderName) {
      return res.status(400).json({ error: "occasionName and senderName required" });
    }

    const style = promptHint || `Write a ${tone} ${occasionName} invitation.`;
    const familyLine = familyMembers
      ? `\nMention this family blessing line naturally if it fits: "${familyMembers}"`
      : "";

    const prompt = `${style}
The ENTIRE invitation MUST be written in ${lang}. Every single word MUST be in ${lang} — including the occasion/event name. Do NOT keep any English words. Translate EVERYTHING.
For example, if the occasion is "Naming Ceremony" and language is Marathi, write "बारसे" or "नामकरण सोहळा", NOT "Naming Ceremony". If language is Hindi, write "नामकरण संस्कार". Always use the culturally correct term in ${lang}.
This is a GROUP invitation — sent to MANY people, not one person.
Tone: ${toneDesc}.

CRITICAL RULES:
1. Write ONLY the body text (3-4 sentences).
2. Do NOT start with any greeting like "Dear...", "प्रिय...", "প্রিয়..." — the app adds the greeting automatically.
3. Do NOT end with sender name, "—", "Warm regards", "आपला/आपली", "सादर", "With love" etc. — the app adds those automatically.
4. Stay completely gender-neutral. No gendered host words.
5. Use group-friendly language ("you all", "everyone", "सर्वांना", "सभी").
6. Add 1-2 relevant emojis naturally within the text.
7. No jokes (unless tone is funny), no sarcasm, no inappropriate lines. Keep it natural and meaningful.
8. NEVER use any English words when writing in a non-English language. Translate occasion names, greetings, and all terms to ${lang}.${familyLine}

Context — Occasion: ${occasionName}. Sender: ${senderName}. ${date ? `Date: ${date}.` : ""} ${time ? `Time: ${time}.` : ""} ${location ? `Venue: ${location}.` : ""}
${note ? `Special note: ${note}` : ""}

Return ONLY the invitation body in ${lang}. No greeting, no closing, no sender name. Zero English words.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    let text = (message.content?.[0]?.text || "").trim();

    // Strip any leaked greetings/closings
    text = text.replace(
      /^(Dear\s+[^,\n]+,?\s*\n*|प्रिय\s+[^,\n]+,?\s*\n*|প্রিয়\s+[^,\n]+,?\s*\n*|ప్రియమైన\s+[^,\n]+,?\s*\n*|அன்புள்ள\s+[^,\n]+,?\s*\n*|ಪ್ರಿಯ\s+[^,\n]+,?\s*\n*|પ્રિય\s+[^,\n]+,?\s*\n*|ਪਿਆਰੇ\s+[^,\n]+,?\s*\n*|عزیز\s+[^,\n]+,?\s*\n*|പ്രിയ\s+[^,\n]+,?\s*\n*)/i,
      ""
    ).trim();
    text = text.replace(
      /\n*(—\s*.+|With\s+(love|warm|best|regards|blessings)[^]*?$|Warm(ly)?\s+regards[^]*?$|आपला\s+.+$|आपली\s+.+$|सादर[,\s]*\n*.+$|आपला\/आपली[^]*?$|With\s+\w+,?\s*\n*.+$)/im,
      ""
    ).trim();

    if (text.length > 1000) text = text.slice(0, 1000);

    return res.json({ text, used: quota.used, limit: quota.limit, tier: quota.tier });
  } catch (e) {
    console.error("generate error:", e.message);
    const occasionName = sanitize(req.body.occasionName, 100) || "the event";
    const fallback = `You are all warmly invited to celebrate ${occasionName} with us! It would be a joy to have everyone's presence on this special occasion. Let's come together and make this celebration truly memorable! ✨`;
    return res.json({ text: fallback, fallback: true });
  }
});

module.exports = router;
