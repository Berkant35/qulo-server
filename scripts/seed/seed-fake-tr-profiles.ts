/**
 * Stage 2: Insert 350 fake Turkish women profiles into Supabase.
 * Reads photo manifest from Stage 1.
 *
 * Usage:
 *   npx tsx scripts/seed/seed-fake-tr-profiles.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { TR_CITIES, TOTAL_QUOTA } from './data/tr-cities.js';
import { TR_FEMALE_FIRST_NAMES, TR_SURNAMES } from './data/tr-female-names.js';
import { TR_JOBS, renderBio } from './data/tr-bio-pool.js';
import { rand, jitter, pickRandom, weightedPick, sample } from './lib/random.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(__dirname, 'output', 'photos-manifest.json');

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SEED_PASSWORD = 'SeedFake1234!';
const ZODIACS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra',
                 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const PERSONALITIES = ['Introvert', 'Extrovert', 'Ambivert'];

interface ManifestEntry {
  seq: number;
  storage_url: string;
}

interface QuestionBankRow {
  question_text: string;
  answers: string[];
  category: string;
}

function loadManifest(): ManifestEntry[] {
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as ManifestEntry[];
  if (raw.length < TOTAL_QUOTA) {
    throw new Error(`Manifest has ${raw.length} entries, need ${TOTAL_QUOTA}. Run Stage 1 first.`);
  }
  return raw;
}

async function loadQuestionPool(): Promise<QuestionBankRow[]> {
  const { data, error } = await supabase
    .from('ai_question_bank')
    .select('question_text, answers, category')
    .eq('locale', 'tr')
    .eq('is_active', true)
    .limit(2000);
  if (error) throw new Error(`question_bank query: ${error.message}`);
  if (!data || data.length < 100) throw new Error(`Insufficient TR question_bank rows: ${data?.length}`);
  return data as QuestionBankRow[];
}

function randomLastSeen(): string {
  const hoursAgo = rand(0, 72);
  return new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
}

function randomAlpha(len: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function seedOneProfile(
  seq: number,
  city: { name: string; lat: number; lng: number },
  manifest: ManifestEntry[],
  questionPool: QuestionBankRow[],
  usedNames: Set<string>,
  passwordHash: string,
): Promise<boolean> {
  const email = `seed_tr_${String(seq).padStart(3, '0')}@qulo.test`;

  const { data: existing } = await supabase
    .from('users').select('id').eq('email', email).maybeSingle();
  if (existing) {
    console.log(`  ⏭️  ${email} exists, skipping`);
    return false;
  }

  // Pick unique name pair
  let name = '', surname = '', key = '';
  let attempts = 0;
  do {
    name = pickRandom(TR_FEMALE_FIRST_NAMES);
    surname = pickRandom(TR_SURNAMES);
    key = `${name} ${surname}`;
    attempts++;
    if (attempts > 100) throw new Error('Name pool exhausted');
  } while (usedNames.has(key));
  usedNames.add(key);

  const age = rand(22, 38);
  const job = pickRandom(TR_JOBS);
  const bio = renderBio(city.name, job);
  const lat = city.lat + jitter(0.05);
  const lng = city.lng + jitter(0.05);

  const photoEntry = manifest.find((m) => m.seq === seq);
  if (!photoEntry) throw new Error(`Manifest missing seq=${seq}`);

  const userPayload = {
    email,
    password_hash: passwordHash,
    name,
    surname,
    age,
    gender: 'WOMAN',
    gender_pref: 'MAN',
    bio,
    city: city.name,
    country: 'Turkey',
    lat,
    lng,
    locale: 'tr',
    preferred_languages: ['tr'],
    match_radius_km: rand(25, 100),
    age_pref_min: Math.max(18, age - 5),
    age_pref_max: Math.min(50, age + 8),
    relationship_goal: weightedPick({ SERIOUS: 50, NOT_SURE: 30, FRIENDSHIP: 15, CASUAL: 5 }),
    email_verified: true,
    is_online: Math.random() < 0.3,
    profile_completion: rand(78, 92),
    green_diamonds: rand(10, 40),
    photos: [photoEntry.storage_url],
    is_seed_profile: true,
    is_test_account: false,
    last_seen_at: randomLastSeen(),
    referral_code: `S${String(seq).padStart(3, '0')}${randomAlpha(5)}`,
  };

  const { data: inserted, error } = await supabase
    .from('users').insert(userPayload).select('id').single();
  if (error || !inserted) {
    console.error(`  ❌ ${email}: ${error?.message ?? 'unknown insert error'}`);
    return false;
  }
  const userId = inserted.id as string;

  // user_details
  const detailsErr = await supabase.from('user_details').insert({
    user_id: userId,
    height: rand(158, 180),
    zodiac: pickRandom(ZODIACS),
    job,
    smoking: weightedPick({ NO: 60, SOMETIMES: 30, YES: 10 }),
    alcohol: weightedPick({ SOMETIMES: 50, NO: 35, YES: 15 }),
    personality: pickRandom(PERSONALITIES),
  });
  if (detailsErr.error) console.warn(`  ⚠️  user_details: ${detailsErr.error.message}`);

  // user_languages
  const langErr = await supabase.from('user_languages').insert({ user_id: userId, locale: 'tr' });
  if (langErr.error) console.warn(`  ⚠️  user_languages: ${langErr.error.message}`);

  // questions × 3
  const picks = sample(questionPool, 3);
  for (let i = 0; i < picks.length; i++) {
    const q = picks[i];
    const qErr = await supabase.from('questions').insert({
      user_id: userId,
      order_num: i + 1,
      question_text: q.question_text,
      answer_1: q.answers[0],
      answer_2: q.answers[1],
      answer_3: q.answers[2],
      answer_4: q.answers[3],
      correct_answer: rand(1, 4),
      category: q.category,
      time_limit: 30,
      locale: 'tr',
    });
    if (qErr.error) console.warn(`  ⚠️  question ${i + 1}: ${qErr.error.message}`);
  }

  console.log(`  ✅ ${seq.toString().padStart(3, '0')} ${name} ${surname} (${city.name}, ${age}) — 3 questions`);
  return true;
}

async function main() {
  console.log('\n🌱 Seeding 350 fake Turkish profiles...\n');

  const manifest = loadManifest();
  const questionPool = await loadQuestionPool();
  const usedNames = new Set<string>();
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  let seq = 1;
  let created = 0;
  for (const city of TR_CITIES) {
    for (let i = 0; i < city.count; i++) {
      try {
        const ok = await seedOneProfile(seq, city, manifest, questionPool, usedNames, passwordHash);
        if (ok) created++;
      } catch (e) {
        console.error(`  ❌ seq=${seq}: ${e instanceof Error ? e.message : e}`);
      }
      seq++;
    }
  }

  console.log(`\n📊 Created: ${created} | Total seq: ${seq - 1}\n`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
