import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";

export class UserInterestsService {
  /**
   * Persists the user's interest tags. Empty array = "let server choose"
   * fallback. Deduplicates input defensively even though Zod restricts to
   * the curated pool.
   */
  async setInterests(userId: string, interests: string[]) {
    const unique = Array.from(new Set(interests));

    const { data, error } = await supabase
      .from("users")
      .update({ interests: unique })
      .eq("id", userId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) throw Errors.USER_NOT_FOUND();

    return { interests: unique };
  }
}

export const userInterestsService = new UserInterestsService();
