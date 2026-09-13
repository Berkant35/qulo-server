-- Increment times_shown for array of user IDs
CREATE OR REPLACE FUNCTION increment_times_shown(user_ids UUID[])
RETURNS VOID AS $$
BEGIN
  UPDATE users SET times_shown_count = times_shown_count + 1
  WHERE id = ANY(user_ids);
END;
$$ LANGUAGE plpgsql;

-- Increment like_received for a single user
CREATE OR REPLACE FUNCTION increment_like_received(target_user_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE users SET like_received_count = like_received_count + 1
  WHERE id = target_user_id;
END;
$$ LANGUAGE plpgsql;
