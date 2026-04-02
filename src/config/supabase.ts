import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

export async function ensureStorageBuckets() {
  const buckets = [
    {
      id: "photos",
      options: {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024,
        allowedMimeTypes: ["image/jpeg", "image/png"],
      },
    },
    {
      id: "chat-media",
      options: {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "audio/mp4", "audio/m4a", "audio/mpeg", "audio/aac"],
      },
    },
  ];

  for (const bucket of buckets) {
    const { error } = await supabase.storage.createBucket(bucket.id, bucket.options);
    if (error) {
      if (error.message && error.message.includes("already exists")) {
        console.log(`[storage] '${bucket.id}' bucket exists`);
      } else {
        console.error(`[storage] Failed to create '${bucket.id}' bucket:`, error.message ?? error);
      }
    } else {
      console.log(`[storage] Created '${bucket.id}' bucket`);
    }
  }
}
