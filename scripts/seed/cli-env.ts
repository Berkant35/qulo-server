/** Seed CLI'ları için ortak ortam: .env + service-role Supabase istemcisi. Eksik env'de fırlatır (exit'i main yapar). */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} eksik (.env)`);
  return value;
}

export function createSeedClient() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
}
