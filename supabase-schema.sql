-- Supabase schema for Nova Studio
-- Run this in Supabase SQL Editor

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Analytics table
CREATE TABLE IF NOT EXISTS analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ts TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ip TEXT,
  path TEXT,
  ua TEXT,
  ref TEXT
);

ALTER TABLE analytics ADD COLUMN IF NOT EXISTS event TEXT DEFAULT 'pageview';
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS visitor_id TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS ref_host TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS browser TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS browser_version TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS os TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS screen TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS duration INTEGER;
ALTER TABLE analytics ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_analytics_ts ON analytics(ts DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_ip ON analytics(ip);
CREATE INDEX IF NOT EXISTS idx_analytics_session_id ON analytics(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_visitor_id ON analytics(visitor_id);
CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics(event);

-- Enable Row Level Security (optional, for security)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public analytics insert" ON analytics;
DROP POLICY IF EXISTS "Allow public analytics select" ON analytics;
DROP POLICY IF EXISTS "Allow user registration" ON users;
DROP POLICY IF EXISTS "Allow user login" ON users;
