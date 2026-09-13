-- Migration 012: Profile Preferences & Completion Incentive System
-- Adds relationship_goal enum, preferred_languages array, and completion rewards tracking

-- Yeni enum: ilişki amacı
CREATE TYPE relationship_goal_type AS ENUM ('SERIOUS', 'FRIENDSHIP', 'NOT_SURE');

-- Users tablosuna yeni alanlar
ALTER TABLE users ADD COLUMN relationship_goal relationship_goal_type DEFAULT 'NOT_SURE';
ALTER TABLE users ADD COLUMN preferred_languages TEXT[] DEFAULT ARRAY['tr'];
ALTER TABLE users ADD COLUMN completion_rewards_claimed JSONB DEFAULT '{}';
