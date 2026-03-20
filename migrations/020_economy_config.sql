-- 020_economy_config.sql
-- Economy config versioning table

CREATE TABLE economy_config_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INT NOT NULL,
  config JSONB NOT NULL,
  is_active BOOLEAN DEFAULT false,
  changed_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  change_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_active_economy_config
  ON economy_config_versions(is_active) WHERE is_active = true;

-- RPC function for atomic version activation (transaction-safe)
CREATE OR REPLACE FUNCTION create_economy_config_version(
  p_version INT,
  p_config JSONB,
  p_changed_by UUID,
  p_change_reason TEXT
) RETURNS economy_config_versions AS $$
DECLARE
  result economy_config_versions;
BEGIN
  UPDATE economy_config_versions SET is_active = false WHERE is_active = true;

  INSERT INTO economy_config_versions (version, config, is_active, changed_by, change_reason)
  VALUES (p_version, p_config, true, p_changed_by, p_change_reason)
  RETURNING * INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Seed v1 with current hardcoded values
INSERT INTO economy_config_versions (version, config, is_active, change_reason)
VALUES (1, '{
  "core": {
    "boostCostGreen": 30,
    "boostDurationMinutes": 30,
    "greenDiamondRewardRatio": 0.30,
    "greenToPurpleRatio": 3,
    "questionCountMultipliers": {
      "2": 0.5,
      "3": 0.75,
      "4": 1.0,
      "5": 1.25,
      "6": 1.5
    }
  },
  "subscriptionLimits": {
    "free": {
      "dailyDiscovers": 50,
      "maxQuestions": 4,
      "dailyUndos": 0,
      "monthlyPurpleBonus": 0,
      "chatQuestionDaily": 2,
      "chatQuestionUnmatchRisk": 1,
      "passportMode": false,
      "hasAds": true
    },
    "plus": {
      "dailyDiscovers": 999999,
      "maxQuestions": 6,
      "dailyUndos": 3,
      "monthlyPurpleBonus": 500,
      "chatQuestionDaily": 5,
      "chatQuestionUnmatchRisk": 2,
      "passportMode": false,
      "hasAds": false
    },
    "premium": {
      "dailyDiscovers": 999999,
      "maxQuestions": 10,
      "dailyUndos": 999999,
      "monthlyPurpleBonus": 1500,
      "chatQuestionDaily": 999999,
      "chatQuestionUnmatchRisk": 999999,
      "passportMode": true,
      "hasAds": false
    }
  },
  "rewards": {
    "milestones": {
      "25": 5,
      "50": 15,
      "75": 30,
      "100": 50
    },
    "referralPurple": 25,
    "maxCompletedReferrals": 10
  },
  "timing": {
    "questionTimeSeconds": 30,
    "timeExtendSeconds": 15,
    "timePresets": [15, 30, 60, 90]
  }
}'::jsonb, true, 'Initial seed from hardcoded values');
