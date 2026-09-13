-- ============================================================
-- 001_initial_schema.sql
-- Qulo V2 - Complete database schema
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE gender_type AS ENUM ('MAN', 'WOMAN');
CREATE TYPE gender_pref_type AS ENUM ('MAN', 'WOMAN', 'BOTH');
CREATE TYPE frequency_type AS ENUM ('YES', 'NO', 'SOMETIMES');
CREATE TYPE swipe_action AS ENUM ('LIKE', 'REJECT');
CREATE TYPE quiz_status AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');
CREATE TYPE diamond_type AS ENUM ('GREEN', 'PURPLE');
CREATE TYPE report_status AS ENUM ('PENDING', 'REVIEWED', 'RESOLVED');

-- ============================================================
-- TABLES
-- ============================================================

-- users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  verify_token TEXT,
  name TEXT NOT NULL,
  surname TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 18 AND age <= 99),
  gender gender_type NOT NULL,
  gender_pref gender_pref_type NOT NULL DEFAULT 'BOTH',
  bio TEXT,
  city TEXT,
  country TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  match_radius_km INTEGER NOT NULL DEFAULT 50 CHECK (match_radius_km >= 1 AND match_radius_km <= 500),
  age_pref_min INTEGER NOT NULL DEFAULT 18,
  age_pref_max INTEGER NOT NULL DEFAULT 45,
  photos TEXT[] NOT NULL DEFAULT '{}',
  green_diamonds INTEGER NOT NULL DEFAULT 0 CHECK (green_diamonds >= 0),
  purple_diamonds INTEGER NOT NULL DEFAULT 0 CHECK (purple_diamonds >= 0),
  is_online BOOLEAN NOT NULL DEFAULT false,
  push_token TEXT,
  passport_city TEXT,
  passport_lat DOUBLE PRECISION,
  passport_lng DOUBLE PRECISION,
  profile_completion INTEGER NOT NULL DEFAULT 0 CHECK (profile_completion >= 0 AND profile_completion <= 100),
  locale TEXT NOT NULL DEFAULT 'tr' CHECK (locale IN ('tr', 'en')),
  like_received_count INTEGER NOT NULL DEFAULT 0,
  times_shown_count INTEGER NOT NULL DEFAULT 0,
  boost_until TIMESTAMPTZ,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_details
CREATE TABLE user_details (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  height INTEGER,
  weight INTEGER,
  zodiac TEXT,
  job TEXT,
  school TEXT,
  smoking frequency_type,
  alcohol frequency_type,
  pets TEXT,
  music_type TEXT,
  personality TEXT
);

-- questions
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_num INTEGER NOT NULL CHECK (order_num >= 1 AND order_num <= 6),
  question_text TEXT NOT NULL,
  correct_answer INTEGER NOT NULL CHECK (correct_answer >= 1 AND correct_answer <= 4),
  answer_1 TEXT NOT NULL,
  answer_2 TEXT NOT NULL,
  answer_3 TEXT NOT NULL,
  answer_4 TEXT NOT NULL,
  hint_text TEXT,
  stats_correct INTEGER NOT NULL DEFAULT 0,
  stats_wrong INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, order_num)
);

-- swipes
CREATE TABLE swipes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  swiper_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action swipe_action NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (swiper_id, target_id)
);

-- quiz_sessions
CREATE TABLE quiz_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  solver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_q INTEGER NOT NULL DEFAULT 1,
  status quiz_status NOT NULL DEFAULT 'IN_PROGRESS',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

-- quiz_answers
CREATE TABLE quiz_answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_answer INTEGER NOT NULL CHECK (selected_answer >= 1 AND selected_answer <= 4),
  is_correct BOOLEAN NOT NULL,
  power_used TEXT,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- matches
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (user1_id, user2_id)
);

-- messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_image BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- diamond_transactions
CREATE TABLE diamond_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type diamond_type NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- powers
CREATE TABLE powers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  base_cost INTEGER NOT NULL,
  description TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- iap_products
CREATE TABLE iap_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id_android TEXT,
  store_id_ios TEXT,
  purple_amount INTEGER NOT NULL,
  tier INTEGER NOT NULL CHECK (tier >= 1 AND tier <= 6),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- reports
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status report_status NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- refresh_tokens
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- DISABLE RLS ON ALL TABLES (service_role access)
-- ============================================================

ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_details DISABLE ROW LEVEL SECURITY;
ALTER TABLE questions DISABLE ROW LEVEL SECURITY;
ALTER TABLE swipes DISABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_answers DISABLE ROW LEVEL SECURITY;
ALTER TABLE matches DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE diamond_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE powers DISABLE ROW LEVEL SECURITY;
ALTER TABLE iap_products DISABLE ROW LEVEL SECURITY;
ALTER TABLE reports DISABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens DISABLE ROW LEVEL SECURITY;
