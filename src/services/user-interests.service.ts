import { supabase } from "../config/supabase.js";

export async function setInterests(userId: string, interests: string[]) {
  // Deduplicate (schema allows duplicates by design; service hardens)
  const unique = Array.from(new Set(interests));

  const { error } = await supabase
    .from("users")
    .update({ interests: unique })
    .eq("id", userId);

  if (error) throw error;

  return { interests: unique };
}
