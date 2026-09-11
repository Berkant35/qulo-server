// realtime_anon_probe.cjs — Supabase Realtime'in anon key ile hala teslimat yapip yapmadigini
// ve payload'da hangi kolonlarin sizdigini olcen CANLI kanit araci (RLS/GRANT migration'lari icin
// yesil/kirmizi test). Offline test degildir; vitest'e dahil edilmez.
//
// Mobil `matches:online` kanalinin birebir kopyasi: users UPDATE, filter id=in.(tester).
// service_role ile tester_001'in is_online'i degistirilir, sonra geri alinir (veri kalici degismez).
//
// Kullanim (qulo-server dizininden):
//   node scripts/realtime_anon_probe.cjs <etiket>
// Anahtarlar: SUPABASE_SERVICE_ROLE_KEY ve SUPABASE_URL .env'den; anon key
//   SUPABASE_ANON_KEY env'inden, yoksa ../qulov2/lib/core/config/env.dart varsayilanindan okunur.
//   Komut satirina anahtar gomme.
//
// TUZAK (2026-09-11'de olculdu): `SUBSCRIBED` yalnizca kanal join'idir; DB aboneligi
//   `system: "Subscribed to PostgreSQL"` mesajiyla kesinlesir. Tetik ondan once atilirsa olay
//   gelmez ve test SAHTE KIRMIZI verir. Bu script o mesaji bekler (6 sn fallback).
const fs = require('fs');
const path = require('path');
const SERVER = path.resolve(__dirname, '..');
const { createClient } = require('@supabase/supabase-js');

const envText = fs.readFileSync(path.join(SERVER, '.env'), 'utf8');
const envGet = (k) => { const l = envText.split('\n').find((x) => x.startsWith(k + '=')); return l ? l.slice(k.length + 1).trim().replace(/^["']|["']$/g, '') : ''; };
const url = process.env.SUPABASE_URL || envGet('SUPABASE_URL');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envGet('SUPABASE_SERVICE_ROLE_KEY');
let anonKey = process.env.SUPABASE_ANON_KEY || '';
if (!anonKey) {
  const dart = fs.readFileSync(path.join(SERVER, '..', 'qulov2', 'lib', 'core', 'config', 'env.dart'), 'utf8');
  anonKey = (dart.match(/eyJ[A-Za-z0-9._-]+/) || [''])[0];
}
if (!url || !serviceKey || !anonKey) { console.error('SUPABASE_URL / SERVICE_ROLE_KEY / ANON_KEY eksik'); process.exit(1); }
const label = process.argv[2] || 'test';
const TESTER_EMAIL = 'tester_001@qulo.test';
const SENSITIVE = ['email', 'password_hash', 'push_token', 'lat', 'lng', 'verify_token'];

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(url, anonKey, noPersist);
const svc = createClient(url, serviceKey, noPersist);

function out(k, v) { console.log(`[${label}] ${k}: ${v}`); }

async function main() {
  const { data: tester, error: e1 } = await svc.from('users')
    .select('id,is_online').eq('email', TESTER_EMAIL).single();
  if (e1) throw e1;
  out('tester', `${tester.id} is_online=${tester.is_online}`);

  // Mobil 'matches:online' kanalinin birebir kopyasi (users UPDATE, id=in.(...))
  const received = new Promise((resolve) => {
    // NOT: SUBSCRIBED = kanal join'i; DB aboneligi ancak 'system' mesajindaki
    // "Subscribed to PostgreSQL" ile kesinlesir. Ilk denemede 1,5 sn sonra tetiklemek
    // erken kaldi ve olay gelmedi (sahte kirmizi). Tetik bu mesaji bekler, 6 sn fallback.
    let triggered = false;
    const fire = () => { if (!triggered) { triggered = true; trigger(); } };
    anon.channel('test:online')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'users', filter: `id=in.(${tester.id})`,
      }, (payload) => resolve(payload))
      .on('system', {}, (msg) => {
        out('users-kanal-system', `${msg.status} ${msg.message}`);
        if (msg.status === 'ok' && /Subscribed to PostgreSQL/.test(msg.message)) fire();
      })
      .subscribe((status, err) => {
        out('users-kanal-durum', status + (err ? ' ' + err.message : ''));
        if (status === 'SUBSCRIBED') setTimeout(fire, 6000);
      });
  });

  // Mobil 'chat:<matchId>' kanalinin kopyasi — sadece abonelik durumu olculur (veri uretilmez)
  const msgStatus = new Promise((resolve) => {
    anon.channel('test:chat')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages', filter: 'match_id=eq.00000000-0000-0000-0000-000000000000',
      }, () => {})
      .subscribe((status, err) => { out('messages-kanal-durum', status + (err ? ' ' + err.message : '')); if (status !== 'CHANNEL_ERROR' || true) resolve(status); });
  });

  async function trigger() {
    await new Promise((r) => setTimeout(r, 500));
    const { error } = await svc.from('users').update({ is_online: !tester.is_online }).eq('id', tester.id);
    out('tetik', error ? 'HATA ' + error.message : `is_online -> ${!tester.is_online} (service_role)`);
  }

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 15000));
  const payload = await Promise.race([received, timeout]);
  await Promise.race([msgStatus, new Promise((r) => setTimeout(r, 3000))]);

  if (!payload) {
    out('SONUC', 'KIRMIZI-YESIL-REGRESYON: 15 sn icinde users UPDATE olayi GELMEDI');
  } else {
    const keys = Object.keys(payload.new || {});
    const hasId = 'id' in payload.new, hasOnline = 'is_online' in payload.new;
    const leaked = SENSITIVE.filter((c) => c in payload.new);
    out('olay', `${payload.eventType} kolon sayisi=${keys.length}`);
    out('payload-kolonlar', keys.join(','));
    out('yesil(id+is_online geldi)', hasId && hasOnline ? 'EVET' : 'HAYIR');
    out('kirmizi(hassas kolon payloadda)', leaked.length ? 'SIZIYOR: ' + leaked.join(',') : 'yok');
  }

  // Tester'i eski haline dondur
  const { error: e2 } = await svc.from('users').update({ is_online: tester.is_online }).eq('id', tester.id);
  out('geri-al', e2 ? 'HATA ' + e2.message : `is_online -> ${tester.is_online}`);
  await anon.removeAllChannels();
  process.exit(payload ? 0 : 2);
}

main().catch((e) => { console.error(`[${label}] HATA`, e.message || e); process.exit(1); });
