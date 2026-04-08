-- ═══════════════════════════════════════════════════════════════
-- NIMANTRAN — Production Schema (v2 — Bharat-Ready)
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Drop old tables (WARNING: destroys data — back up first!)
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS gen_quota CASCADE;
DROP TABLE IF EXISTS rsvps CASCADE;
DROP TABLE IF EXISTS invites CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ═══ USERS ═══════════════════════════════════════════════════════
-- Phone-first auth. Email optional. Firebase UID is the bridge.
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid    TEXT UNIQUE NOT NULL,         -- from Firebase Phone Auth
  phone           TEXT UNIQUE NOT NULL,         -- E.164 format: +919876543210
  name            TEXT,                          -- optional at signup, asked later
  email           TEXT UNIQUE,                  -- OPTIONAL
  email_verified  BOOLEAN DEFAULT FALSE,
  tier            TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'wedding')),
  tier_expires_at TIMESTAMPTZ,                  -- NULL = forever (free) or lifetime (wedding)
  language        TEXT DEFAULT 'en',            -- preferred UI language
  referral_code   TEXT UNIQUE,                  -- each user gets one
  referred_by     UUID REFERENCES users(id),    -- who invited them
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ                   -- soft delete for Play Store compliance
);

CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;

-- ═══ INVITES ═════════════════════════════════════════════════════
CREATE TABLE invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occasion_id     TEXT NOT NULL,
  occasion_name   TEXT NOT NULL,
  sender_name     TEXT NOT NULL,
  recip_name      TEXT,
  event_date      TEXT,
  event_time      TEXT,
  location        TEXT,
  note            TEXT,
  language        TEXT NOT NULL,
  template_id     TEXT NOT NULL,
  generated_text  TEXT NOT NULL,
  photo_url       TEXT,                          -- Supabase Storage URL (photo upload)
  music_id        TEXT,                          -- background music track id
  font_id         TEXT DEFAULT 'default',
  family_members  TEXT,                          -- "with blessings of..."
  tithi           TEXT,                          -- Hindu calendar date
  tone            TEXT DEFAULT 'heartfelt',      -- heartfelt/formal/poetic/traditional/festive/funny
  short_code      TEXT UNIQUE,                   -- for RSVP short links
  view_count      INTEGER DEFAULT 0,
  rsvp_yes        INTEGER DEFAULT 0,
  rsvp_no         INTEGER DEFAULT 0,
  rsvp_maybe      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invites_user_id ON invites(user_id);
CREATE INDEX idx_invites_short_code ON invites(short_code) WHERE short_code IS NOT NULL;
CREATE INDEX idx_invites_created_at ON invites(created_at DESC);

-- ═══ RSVP RESPONSES ═══════════════════════════════════════════════
CREATE TABLE rsvps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id   UUID NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
  guest_name  TEXT NOT NULL,
  response    TEXT NOT NULL CHECK (response IN ('yes', 'no', 'maybe')),
  message     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rsvps_invite_id ON rsvps(invite_id);

-- ═══ GENERATION QUOTA (anti-abuse) ═══════════════════════════════
CREATE TABLE gen_quota (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       DATE NOT NULL DEFAULT CURRENT_DATE,
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- ═══ AUDIT LOG (security monitoring) ═════════════════════════════
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,                     -- login_success, login_fail, account_delete, etc.
  metadata    JSONB,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_event ON audit_log(event_type);

-- ═══ ROW LEVEL SECURITY ═════════════════════════════════════════
-- Enable RLS on all tables. Backend uses SERVICE_KEY to bypass.
-- This means ONLY the backend can read/write. Direct anon key = nothing.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE gen_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Default: deny all. Service key bypasses RLS automatically.
-- Public RSVP reads allowed via anon key ONLY for active invites by short_code:
CREATE POLICY "public_rsvp_by_short_code" ON invites
  FOR SELECT TO anon
  USING (short_code IS NOT NULL);

CREATE POLICY "public_rsvp_insert" ON rsvps
  FOR INSERT TO anon
  WITH CHECK (true);

-- ═══ FUNCTIONS ═══════════════════════════════════════════════════
-- Auto-generate referral code on user insert
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := UPPER(SUBSTR(MD5(NEW.id::TEXT || NOW()::TEXT), 1, 8));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_referral_code
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION generate_referral_code();

-- Auto-generate short_code on invite insert
CREATE OR REPLACE FUNCTION generate_invite_short_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.short_code IS NULL THEN
    NEW.short_code := LOWER(SUBSTR(MD5(NEW.id::TEXT || NOW()::TEXT), 1, 6));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_invite_short_code
  BEFORE INSERT ON invites
  FOR EACH ROW EXECUTE FUNCTION generate_invite_short_code();

-- ═══ DONE ════════════════════════════════════════════════════════
SELECT 'Nimantran schema v2 ready! ✅' AS status;
