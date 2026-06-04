-- Add OTHER to gender_type enum
-- Mobile UI (register_step_gender.dart) and server validators (auth.validator.ts, user.validator.ts)
-- expect MAN/WOMAN/OTHER but DB enum only had MAN/WOMAN, causing complete-profile to fail
-- with: invalid input value for enum gender_type: "OTHER"

ALTER TYPE gender_type ADD VALUE IF NOT EXISTS 'OTHER';
