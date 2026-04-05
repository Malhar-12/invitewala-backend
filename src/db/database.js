const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ SUPABASE_URL and SUPABASE_ANON_KEY are required in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Compatibility layer ─────────────────────────────────
// Wraps Supabase to match the old SQLite-style API
// So auth.js, invites.js, generate.js don't need major changes

async function initDb() {
  // Test connection
  const { error } = await supabase.from("users").select("id").limit(1);
  if (error) {
    console.error("❌ Supabase connection failed:", error.message);
    console.error("   Make sure tables are created in Supabase SQL Editor.");
    process.exit(1);
  }
  console.log("✅ Supabase connected successfully!");
}

function getDb() {
  return {
    prepare(sql) {
      return new QueryBuilder(sql);
    },
  };
}

// ── Query Builder ───────────────────────────────────────
// Translates simple SQL patterns to Supabase queries
class QueryBuilder {
  constructor(sql) {
    this.sql = sql.trim();
  }

  // SELECT ... WHERE column = ? → .get(value) returns one row
  get(...params) {
    return this._execute("get", params);
  }

  // SELECT ... WHERE column = ? → .all(value) returns array
  all(...params) {
    return this._execute("all", params);
  }

  // INSERT/UPDATE/DELETE → .run(values...) executes
  run(...params) {
    return this._executeWrite(params);
  }

  _execute(mode, params) {
    const sql = this.sql;

    // SELECT id FROM users WHERE email = ?
    if (/SELECT .+ FROM users WHERE email/i.test(sql)) {
      return this._selectUsers("email", params[0], mode, sql);
    }

    // SELECT * FROM users WHERE email = ?
    if (/SELECT \* FROM users WHERE email/i.test(sql)) {
      return this._selectUsers("email", params[0], mode, sql);
    }

    // SELECT ... FROM users WHERE id = ?
    if (/SELECT .+ FROM users WHERE id/i.test(sql)) {
      return this._selectUsers("id", params[0], mode, sql);
    }

    // SELECT COUNT(*) as cnt FROM invites WHERE user_id = ?
    if (/SELECT COUNT/i.test(sql)) {
      return this._countInvites(params[0]);
    }

    // SELECT ... FROM invites WHERE user_id = ? ORDER BY ...
    if (/SELECT .+ FROM invites WHERE user_id/i.test(sql)) {
      return this._selectInvites(params[0], mode);
    }

    console.warn("⚠️ Unhandled SELECT query:", sql);
    return mode === "get" ? undefined : [];
  }

  async _selectUsers(field, value, mode, sql) {
    // Determine which columns to select
    let columns = "*";
    const colMatch = sql.match(/SELECT (.+?) FROM/i);
    if (colMatch) {
      const raw = colMatch[1].trim();
      if (raw !== "*") {
        columns = raw;
      }
    }

    const { data, error } = await supabase
      .from("users")
      .select(columns)
      .eq(field, value)
      .limit(1);

    if (error) {
      console.error("DB select users error:", error.message);
      return mode === "get" ? undefined : [];
    }
    return mode === "get" ? (data?.[0] || undefined) : data;
  }

  async _countInvites(userId) {
    const { count, error } = await supabase
      .from("invites")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (error) {
      console.error("DB count error:", error.message);
      return { cnt: 0 };
    }
    return { cnt: count || 0 };
  }

  async _selectInvites(userId, mode) {
    const { data, error } = await supabase
      .from("invites")
      .select("id, occasion_id, occasion_name, sender_name, recip_name, event_date, event_time, location, note, language, template_id, generated_text, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("DB select invites error:", error.message);
      return mode === "get" ? undefined : [];
    }
    return mode === "get" ? (data?.[0] || undefined) : (data || []);
  }

  async _executeWrite(params) {
    const sql = this.sql;

    // INSERT INTO users
    if (/INSERT INTO users/i.test(sql)) {
      const [id, name, email, password] = params;
      const { error } = await supabase.from("users").insert({
        id, name, email, password,
      });
      if (error) {
        console.error("DB insert user error:", error.message);
        throw error;
      }
      return { changes: 1 };
    }

    // INSERT INTO invites
    if (/INSERT INTO invites/i.test(sql)) {
      const [id, user_id, occasion_id, occasion_name, sender_name, recip_name,
        event_date, event_time, location, note, language, template_id, generated_text] = params;
      const { error } = await supabase.from("invites").insert({
        id, user_id, occasion_id, occasion_name, sender_name,
        recip_name, event_date, event_time, location, note,
        language, template_id, generated_text,
      });
      if (error) {
        console.error("DB insert invite error:", error.message);
        throw error;
      }
      return { changes: 1 };
    }

    // DELETE FROM invites WHERE id = ? AND user_id = ?
    if (/DELETE FROM invites/i.test(sql)) {
      const [id, userId] = params;
      const { error, count } = await supabase
        .from("invites")
        .delete()
        .eq("id", id)
        .eq("user_id", userId);
      if (error) {
        console.error("DB delete invite error:", error.message);
        return { changes: 0 };
      }
      // Supabase doesn't return count easily, assume 1 if no error
      return { changes: 1 };
    }

    console.warn("⚠️ Unhandled WRITE query:", sql);
    return { changes: 0 };
  }
}

module.exports = { getDb, initDb };
