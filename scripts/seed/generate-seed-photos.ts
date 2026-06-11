/**
 * Stage 1: Generate 350 Turkish women portrait photos via Replicate Flux.
 *
 * Usage:
 *   npx tsx scripts/seed/generate-seed-photos.ts
 *   npx tsx scripts/seed/generate-seed-photos.ts --regenerate 47
 *   npx tsx scripts/seed/generate-seed-photos.ts --from 1 --to 50
 *
 * Outputs:
 *   - seed-photos-cache/tr_001.jpg ... tr_350.jpg (local)
 *   - photos/seed/tr_001.jpg ... (Supabase storage)
 *   - scripts/seed/output/photos-manifest.json
 */

import 'dotenv/config';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { buildPhotoPrompt } from './data/photo-prompt-pools.js';
import { rand } from './lib/random.js';
import { generateImage } from './lib/replicate.js';
import { downloadToBuffer, uploadFile } from './lib/storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const CACHE_DIR = join(REPO_ROOT, 'seed-photos-cache');
const MANIFEST_PATH = join(__dirname, 'output', 'photos-manifest.json');

const TOTAL = 350;
const CONCURRENCY = 6;

interface ManifestEntry {
  seq: number;
  prompt: string;
  local_path: string;
  storage_url: string;
  generated_at: string;
}

function ensureDirs() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  if (!existsSync(dirname(MANIFEST_PATH))) mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
}

function loadManifest(): Map<number, ManifestEntry> {
  if (!existsSync(MANIFEST_PATH)) return new Map();
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8')) as ManifestEntry[];
  return new Map(raw.map((e) => [e.seq, e]));
}

function saveManifest(entries: Map<number, ManifestEntry>) {
  const sorted = [...entries.values()].sort((a, b) => a.seq - b.seq);
  writeFileSync(MANIFEST_PATH, JSON.stringify(sorted, null, 2));
}

function seqFileName(seq: number): string {
  return `tr_${String(seq).padStart(3, '0')}.jpg`;
}

async function generateOne(seq: number, force = false): Promise<ManifestEntry> {
  const fileName = seqFileName(seq);
  const localPath = join(CACHE_DIR, fileName);
  const storagePath = `seed/${fileName}`;

  if (!force && existsSync(localPath)) {
    console.log(`  ⏭️  ${seq.toString().padStart(3, '0')} exists, skipping generation`);
    // still upload + return entry (idempotent for resumed runs)
    const url = await uploadFile(localPath, storagePath);
    return {
      seq,
      prompt: '(cached)',
      local_path: localPath,
      storage_url: url,
      generated_at: new Date().toISOString(),
    };
  }

  const age = rand(22, 38);
  const prompt = buildPhotoPrompt(age);
  const replicateUrl = await generateImage(prompt);
  const buffer = await downloadToBuffer(replicateUrl);
  writeFileSync(localPath, buffer);
  const storageUrl = await uploadFile(localPath, storagePath);
  console.log(`  ✅ ${seq.toString().padStart(3, '0')} (age ${age}) → ${storageUrl}`);
  return {
    seq,
    prompt,
    local_path: localPath,
    storage_url: storageUrl,
    generated_at: new Date().toISOString(),
  };
}

async function runBatch(seqs: number[], force: boolean, manifest: Map<number, ManifestEntry>) {
  for (let i = 0; i < seqs.length; i += CONCURRENCY) {
    const slice = seqs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(slice.map((s) => generateOne(s, force)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const seq = slice[j];
      if (r.status === 'fulfilled') {
        manifest.set(seq, r.value);
      } else {
        console.error(`  ❌ ${seq}: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
      }
    }
    saveManifest(manifest);
    console.log(`  💾 manifest saved (${manifest.size} entries)`);
  }
}

function parseArgs(): { mode: 'all' | 'regen' | 'range'; from?: number; to?: number; seq?: number } {
  const args = process.argv.slice(2);
  const regenIdx = args.indexOf('--regenerate');
  if (regenIdx >= 0) return { mode: 'regen', seq: Number(args[regenIdx + 1]) };
  const fromIdx = args.indexOf('--from');
  const toIdx = args.indexOf('--to');
  if (fromIdx >= 0 && toIdx >= 0) {
    return { mode: 'range', from: Number(args[fromIdx + 1]), to: Number(args[toIdx + 1]) };
  }
  return { mode: 'all' };
}

async function main() {
  ensureDirs();
  const manifest = loadManifest();
  const args = parseArgs();

  let seqs: number[];
  let force = false;
  if (args.mode === 'regen') {
    if (!args.seq || args.seq < 1 || args.seq > TOTAL) throw new Error('invalid --regenerate seq');
    seqs = [args.seq];
    force = true;
  } else if (args.mode === 'range') {
    if (!args.from || !args.to || args.from > args.to) throw new Error('invalid --from/--to');
    seqs = [];
    for (let i = args.from; i <= args.to; i++) seqs.push(i);
  } else {
    seqs = [];
    for (let i = 1; i <= TOTAL; i++) seqs.push(i);
  }

  console.log(`\n🎨 Generating ${seqs.length} photo(s) (concurrency ${CONCURRENCY})\n`);
  const start = Date.now();
  await runBatch(seqs, force, manifest);
  const sec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✨ Done in ${sec}s — manifest: ${manifest.size}/350 entries\n`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
