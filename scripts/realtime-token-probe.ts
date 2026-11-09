/**
 * Canlı kanıt: Supabase, sunucunun imzaladığı Realtime JWT'sini kabul ediyor mu? (082/083 önkoşulu)
 * Offline test DEĞİLDİR, vitest'e dahil edilmez. Veri üretmez, satır basmaz.
 *
 * Kullanım (qulo-server dizininden, Railway env'iyle; sır komut satırına girmez):
 *   railway run npx tsx scripts/realtime-token-probe.ts <publishable-key-dosyasi> [user-uuid]
 *
 * Ölçülenler:
 *   1. PostgREST `GET /rest/v1/matches?select=id&limit=0` + `Authorization: Bearer <token>`.
 *      İmza reddi → 401 + PGRST301/PGRST303 ("JWT" mesajı). Kabul → 200/206 (082 öncesi) ya da
 *      200 + 0 satır (082 sonrası, sub katılımcı değilse).
 *   2. Realtime: `setAuth(token)` + `matches:new` aboneliği → "Subscribed to PostgreSQL" gelmeli.
 *      Token reddinde kanal CHANNEL_ERROR / "Invalid token" döner.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { env } from '../src/config/env.js';
import { realtimeTokenService } from '../src/services/realtime-token.service.js';

const keyFile = process.argv[2];
const userId = process.argv[3] ?? '00000000-0000-4000-8000-000000000000';
if (!keyFile) {
  console.error('kullanim: railway run npx tsx scripts/realtime-token-probe.ts <publishable-key-dosyasi> [user-uuid]');
  process.exit(1);
}
const publishable = readFileSync(keyFile, 'utf8').trim();
const out = (k: string, v: string) => console.log(`[realtime-token-probe] ${k}: ${v}`);

async function main() {
  out('signer', realtimeTokenService.kind + (realtimeTokenService.disabledReason ? ` (${realtimeTokenService.disabledReason})` : ''));
  const { token, expiresAt } = realtimeTokenService.issue(userId);
  out('token', `uretildi, expiresAt=${expiresAt}`);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/matches?select=id&limit=0`, {
    headers: { apikey: publishable, Authorization: `Bearer ${token}`, Prefer: 'count=exact' },
  });
  const body = res.status >= 400 ? await res.text() : '';
  const code = body.match(/"code":"([^"]+)"/)?.[1] ?? '-';
  out('postgrest', `HTTP ${res.status} code=${code} content-range=${res.headers.get('content-range') ?? '-'}`);
  out('imza-kabul', res.status === 401 && /PGRST30[0-9]|JWT/i.test(body) ? 'HAYIR (Supabase imzayi reddetti)' : 'EVET');

  const client = createClient(env.SUPABASE_URL, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  await client.realtime.setAuth(token);
  const sonuc = await new Promise<string>((resolve) => {
    const t = setTimeout(() => resolve('ZAMAN ASIMI (12 sn)'), 12_000);
    client.channel('probe:matches-new')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' }, () => {})
      .on('system', {}, (m: { status?: string; message?: string }) => {
        if (/PostgreSQL/.test(m.message ?? '')) { clearTimeout(t); resolve(`${m.status}: ${m.message}`); }
      })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(t); resolve(`${status} ${err?.message ?? ''}`); }
      });
  });
  out('realtime', sonuc);
  await client.removeAllChannels();
  process.exit(0);
}

main().catch((e) => { console.error('[realtime-token-probe] HATA', e instanceof Error ? e.message : e); process.exit(1); });
