-- 007_badge_rewards.sql
-- Add badge rewards tracking to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS badge_rewards_claimed TEXT[] DEFAULT '{}';
