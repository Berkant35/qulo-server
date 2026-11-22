import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';
import { IMAGE_MAX_BYTES, IMAGE_MIME_TYPES, QUESTION_MEDIA_BUCKET, VOICE_MIME_TYPES } from '../constants/question-media.js';

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
    {
      // Soru medyası (sesli/görselli soru): PRIVATE — erişim yalnız sunucunun ürettiği imzalı URL ile.
      id: QUESTION_MEDIA_BUCKET,
      options: {
        public: false,
        fileSizeLimit: IMAGE_MAX_BYTES,
        allowedMimeTypes: [...IMAGE_MIME_TYPES, ...VOICE_MIME_TYPES],
      },
    },
    {
      // Backoffice üzerinden yönetilen statik varlıklar (mascot, banner, kampanya görselleri vb.)
      id: "assets",
      options: {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      },
    },
  ];

  for (const bucket of buckets) {
    // Önce varlık kontrolü: koşulsuz createBucket, Postgres loglarına
    // her restart'ta "duplicate key ... buckets_pkey" (23505) hatası düşürüyor.
    const { data: existing } = await supabase.storage.getBucket(bucket.id);
    if (existing) {
      console.log(`[storage] '${bucket.id}' bucket exists`);
      continue;
    }

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
