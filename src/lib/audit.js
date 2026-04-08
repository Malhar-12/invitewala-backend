// ═══════════════════════════════════════════════════════════════
// Audit Log — fire-and-forget security event recording
// Never blocks the response. Failures are logged but swallowed.
// ═══════════════════════════════════════════════════════════════
const { getSupabase } = require("../db/database");

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || null;
}

/**
 * Record an audit event. Fire-and-forget — never await this.
 * @param {string} eventType  e.g. "login_success", "account_delete", "gen_quota_hit"
 * @param {object} opts       { userId?, req?, metadata? }
 */
function audit(eventType, opts = {}) {
  const { userId = null, req = null, metadata = null } = opts;
  const supabase = getSupabase();

  supabase
    .from("audit_log")
    .insert({
      user_id: userId,
      event_type: eventType,
      metadata,
      ip_address: req ? clientIp(req) : null,
      user_agent: req ? (req.headers["user-agent"] || "").slice(0, 500) : null,
    })
    .then(({ error }) => {
      if (error) console.warn("audit insert failed:", error.message);
    });
}

module.exports = { audit };
