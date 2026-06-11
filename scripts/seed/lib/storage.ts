import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const BUCKET = 'photos';

/**
 * Download a remote URL to a Buffer.
 */
export async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Upload a local file to Supabase storage at the given path inside `photos` bucket.
 * Returns the public URL. Uses upsert=true (idempotent).
 */
export async function uploadFile(localPath: string, storagePath: string): Promise<string> {
  const buffer = readFileSync(localPath);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * Delete a list of storage paths inside `photos` bucket.
 */
export async function deleteFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw new Error(`Delete failed: ${error.message}`);
}
