import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

export async function ensureStorageBuckets() {
  const { error } = await supabase.storage.createBucket("photos", {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: ["image/jpeg", "image/png"],
  });

  if (error) {
    if (error.message?.includes("already exists")) {
      console.log("[storage] 'photos' bucket exists");
    } else {
      console.error("[storage] Failed to create bucket:", error.message);
    }
  } else {
    console.log("[storage] Created 'photos' bucket");
  }
}
