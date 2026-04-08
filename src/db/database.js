// ═══════════════════════════════════════════════════════════════
// Supabase client — uses SERVICE_KEY (bypasses RLS)
// All routes import getSupabase() and use the supabase-js API directly
// ═══════════════════════════════════════════════════════════════
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_KEY are required in .env");
  console.error("   Get the service_role key from Supabase → Project Settings → API");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function initDb() {
  const { error } = await supabase.from("users").select("id").limit(1);
  if (error) {
    console.error("❌ Supabase connection failed:", error.message);
    console.error("   Make sure schema v2 has been applied (run supabase_schema.sql).");
    process.exit(1);
  }
  console.log("✅ Supabase connected (service key, RLS active)");
}

function getSupabase() {
  return supabase;
}

module.exports = { initDb, getSupabase };
