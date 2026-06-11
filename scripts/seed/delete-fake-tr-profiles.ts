/**
 * Delete all seed profiles (is_seed_profile=true) + their related data.
 *
 * Usage:
 *   npx tsx scripts/seed/delete-fake-tr-profiles.ts            # dry-run (count only)
 *   npx tsx scripts/seed/delete-fake-tr-profiles.ts --confirm  # actually delete
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const RELATED_TABLES = [
  'user_details',
  'user_languages',
  'questions',
  'swipes',
  'matches',
  'messages',
  'refresh_tokens',
  'diamond_transactions',
  'notifications',
  'user_badges',
];

async function main() {
  const confirmed = process.argv.includes('--confirm');

  const { data: users, error } = await supabase
    .from('users').select('id, email').eq('is_seed_profile', true);
  if (error) throw new Error(`fetch users: ${error.message}`);
  if (!users || users.length === 0) {
    console.log('ℹ️  No seed profiles found. Nothing to do.');
    return;
  }

  const ids = users.map((u) => u.id as string);
  console.log(`\n📋 Found ${ids.length} seed profiles.\n`);

  if (!confirmed) {
    console.log('🟡 DRY-RUN. Pass --confirm to actually delete.\n');
    return;
  }

  // Delete from related tables
  for (const t of RELATED_TABLES) {
    const { error: e } = await supabase.from(t).delete().in('user_id', ids);
    if (e && !e.message.includes('does not exist')) {
      console.warn(`  ⚠️  ${t}: ${e.message}`);
    } else {
      console.log(`  🧹 ${t} cleaned`);
    }
  }

  // Target-side references
  await supabase.from('swipes').delete().in('target_id', ids);
  await supabase.from('matches').delete().in('user2_id', ids);
  await supabase.from('matches').delete().in('user1_id', ids);

  // Storage cleanup
  const storagePaths = ids.map((_, i) => `seed/tr_${String(i + 1).padStart(3, '0')}.jpg`);
  const { error: storageErr } = await supabase.storage.from('photos').remove(storagePaths);
  if (storageErr) console.warn(`  ⚠️  storage: ${storageErr.message}`);
  else console.log(`  🧹 storage seed/ cleaned (${storagePaths.length} files)`);

  // Final users delete
  const { error: delErr } = await supabase.from('users').delete().eq('is_seed_profile', true);
  if (delErr) throw new Error(`delete users: ${delErr.message}`);

  console.log(`\n✅ Deleted ${ids.length} seed profiles + related data.\n`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
