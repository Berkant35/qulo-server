import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { activeConfigRow, economyConfigFixture } from '../helpers/economy-config.fixture.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const SECRET = 'test-secret-0123456789abcdef';
const UNIT = '1234567890';
const U1 = 'u1';

const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const otherPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const keys = async (id: string) => (id === '1' ? PEM : null);

/** Google'ın sırası: alfabetik; signature + key_id en sonda. */
let ssvOf: (id: string) => string = (id) => id;
function buildQuery(
  over: Record<string, string> = {},
  opts: { signWith?: typeof pair.privateKey; tail?: string; keyId?: string } = {},
): string {
  const p: Record<string, string> = {
    ad_network: '5450213213286189855', ad_unit: UNIT, custom_data: 'TOKEN', reward_amount: '1',
    reward_item: 'coins', timestamp: String(NOW), transaction_id: 'tx-1', user_id: ssvOf(U1), ...over,
  };
  const content = Object.keys(p).sort().map((k) => `${k}=${encodeURIComponent(p[k]!)}`).join('&');
  const sig = createSign('SHA256').update(content).sign(opts.signWith ?? pair.privateKey).toString('base64url');
  return `${content}&signature=${sig}&key_id=${opts.keyId ?? '1'}${opts.tail ?? ''}`;
}

async function setup(
  cfgPatch: Partial<{ enabled: boolean; purple: number; dailyLimit: number }> = {},
  seed: Tables = {},
  fakeOpts: FakeSupabaseOptions = {},
) {
  const row = activeConfigRow();
  const cfg = { ...economyConfigFixture, rewards: { ...economyConfigFixture.rewards, rewardedAd: { enabled: true, purple: 10, dailyLimit: 1, ...cfgPatch } } };
  row.config = cfg;
  const fake = createFakeSupabase({
    economy_config_versions: [row],
    users: [{ id: U1, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0 }, { id: 'u2', purple_diamonds: 0, purple_paid: 0, green_diamonds: 0 }],
    diamond_transactions: [],
    rewarded_ad_claims: [],
    ...seed,
  }, { unique: { rewarded_ad_claims: ['transaction_id', 'user_id,day,slot'] }, ...fakeOpts });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const mod = await import('../../src/services/rewarded-ad.service.js');
  ssvOf = (id) => mod.ssvUserId(id, SECRET);
  const token = (userId = U1, at = NOW) => mod.mintCustomData(userId, at, SECRET);
  const run = (query: string) => mod.rewardedAdService.handleCallback(query, { keys, now: () => NOW });
  return { fake, mod, token, run };
}

const balance = (fake: { table(n: string): Array<Record<string, any>> }, id = U1) =>
  fake.table('users').find((u) => u.id === id)!.purple_diamonds;

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.REWARDED_AD_TOKEN_SECRET = SECRET;
  process.env.REWARDED_AD_UNIT_IDS = `${UNIT}, 999`;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.REWARDED_AD_TOKEN_SECRET;
  delete process.env.REWARDED_AD_UNIT_IDS;
});

describe('rewardedAdService.handleCallback — imza', () => {
  it('geçerli imzalı callback 10 mor yatırır ve talebi kaydeder', async () => {
    const { run, token, fake } = await setup();
    const r = await run(buildQuery({ custom_data: token() }));
    expect(r).toEqual({ httpStatus: 200, outcome: 'rewarded' });
    expect(balance(fake)).toBe(10);
    expect(fake.table('rewarded_ad_claims')).toHaveLength(1);
    expect(fake.table('diamond_transactions')[0]).toMatchObject({
      reason: 'REWARDED_AD', amount: 10, reference_id: 'REWARDED_AD:u1:2026-11-18:1',
    });
  });

  it('başka anahtarla atılmış imza 400, ödül yok', async () => {
    const { run, token, fake } = await setup();
    const r = await run(buildQuery({ custom_data: token() }, { signWith: otherPair.privateKey }));
    expect(r.httpStatus).toBe(400);
    expect(balance(fake)).toBe(0);
    expect(fake.table('rewarded_ad_claims')).toHaveLength(0);
  });

  it('imzalı içerik değiştirilirse (user_id) 400', async () => {
    const { run, token, fake } = await setup();
    const q = buildQuery({ custom_data: token() }).replace(`user_id=${ssvOf(U1)}`, 'user_id=u2');
    expect((await run(q)).httpStatus).toBe(400);
    expect(balance(fake, 'u2')).toBe(0);
  });

  it('bilinmeyen key_id 400', async () => {
    const { run, token } = await setup();
    expect((await run(buildQuery({ custom_data: token() }, { keyId: '77' }))).httpStatus).toBe(400);
  });

  it('imzadan sonra eklenen parametre (kuyruk) reddedilir', async () => {
    const { run, token } = await setup();
    expect((await run(buildQuery({ custom_data: token() }, { tail: '&user_id=u2' }))).httpStatus).toBe(400);
  });

  it('imzalı kısımda yinelenen parametre reddedilir', async () => {
    const { run, token } = await setup();
    // imza yinelenmiş içerik üzerinden atılır -> imza geçerli ama biçim geçersiz
    const t = token();
    const content = `ad_unit=${UNIT}&custom_data=${t}&timestamp=${NOW}&transaction_id=tx-1&user_id=${ssvOf(U1)}&user_id=u2`;
    const sig = createSign('SHA256').update(content).sign(pair.privateKey).toString('base64url');
    expect((await run(`${content}&signature=${sig}&key_id=1`)).httpStatus).toBe(400);
  });

  it('imzalanan dize signature/key_id HARİÇ ham sorgudur: sırayı bozmak imzayı bozar', async () => {
    const { run, token } = await setup();
    const q = buildQuery({ custom_data: token() });
    const [content, tail] = q.split('&signature=');
    const reordered = content!.split('&').reverse().join('&');
    expect((await run(`${reordered}&signature=${tail}`)).httpStatus).toBe(400);
    expect((await run(q)).httpStatus).toBe(200);
  });

  it('Google anahtar sağlayıcısı: yüklenemezse hata fırlar (500 -> Google yeniden dener)', async () => {
    const { mod } = await setup();
    const { createGoogleKeyProvider } = await import('../../src/services/admob-ssv-keys.js');
    const failing = createGoogleKeyProvider(async () => { throw new Error('net'); });
    await expect(mod.rewardedAdService.handleCallback(buildQuery({}), { keys: failing, now: () => NOW })).rejects.toThrow();
  });
});

describe('rewardedAdService.handleCallback — jeton, birim, config', () => {
  it('jeton başka kullanıcıya ait (user_id u1 takma kimliği, jeton u2) -> 200, ödül yok', async () => {
    const { run, token, fake } = await setup();
    const r = await run(buildQuery({ custom_data: token('u2') }));
    expect(r).toEqual({ httpStatus: 200, outcome: 'ignored_token' });
    expect(balance(fake)).toBe(0);
    expect(balance(fake, 'u2')).toBe(0);
  });

  it('dünün jetonu -> ödül yok', async () => {
    const { run, token, fake } = await setup();
    const r = await run(buildQuery({ custom_data: token(U1, NOW - 24 * 3600 * 1000) }));
    expect(r.outcome).toBe('ignored_token');
    expect(balance(fake)).toBe(0);
  });

  it('sahte (imzasız) jeton ve eksik custom_data -> ödül yok', async () => {
    const { run, fake } = await setup();
    expect((await run(buildQuery({ custom_data: 'v2.2026-11-18.abc.AAAA.BBBB' }))).outcome).toBe('ignored_token');
    const noToken = buildQuery({}).replace(/custom_data=TOKEN&/, '');
    // imza geçersiz olur (içerik değişti) -> 400; asıl kapı: jetonsuz ödül yok
    expect((await run(noToken)).httpStatus).toBe(400);
    expect(balance(fake)).toBe(0);
  });

  it('izinsiz ad_unit -> ödül yok; liste boşsa hiçbir birim geçmez', async () => {
    const { run, token, fake } = await setup();
    expect((await run(buildQuery({ custom_data: token(), ad_unit: '5555' }))).outcome).toBe('ignored_unit');
    process.env.REWARDED_AD_UNIT_IDS = '';
    expect((await run(buildQuery({ custom_data: token() }))).outcome).toBe('ignored_unit');
    expect(balance(fake)).toBe(0);
  });

  it('ad_unit tam yol biçimi (ca-app-pub-x/123) listede son parçayla eşleşir', async () => {
    process.env.REWARDED_AD_UNIT_IDS = `ca-app-pub-1~2/${UNIT}`;
    const { run, token } = await setup();
    expect((await run(buildQuery({ custom_data: token() }))).outcome).toBe('rewarded');
  });

  it('enabled=false -> ödül yok', async () => {
    const { run, token, fake } = await setup({ enabled: false });
    expect((await run(buildQuery({ custom_data: token() }))).outcome).toBe('ignored_disabled');
    expect(balance(fake)).toBe(0);
    expect(fake.table('rewarded_ad_claims')).toHaveLength(0);
  });

  it('sır yoksa ödül yok', async () => {
    const { run, token, fake } = await setup();
    const t = token();
    delete process.env.REWARDED_AD_TOKEN_SECRET;
    expect((await run(buildQuery({ custom_data: t }))).outcome).toBe('ignored_token');
    expect(balance(fake)).toBe(0);
  });

  it('eski callback (1 saatten eski timestamp) -> ödül yok', async () => {
    const { run, token, fake } = await setup();
    const old = NOW - 2 * 3600 * 1000;
    expect((await run(buildQuery({ custom_data: token(U1, old), timestamp: String(old) }))).outcome).toBe('ignored_stale');
    expect(balance(fake)).toBe(0);
  });

  it('miktar config’ten gelir, Google reward_amount’a güvenilmez', async () => {
    const { run, token, fake } = await setup({ purple: 7 });
    await run(buildQuery({ custom_data: token(), reward_amount: '9999' }));
    expect(balance(fake)).toBe(7);
  });
});

describe('rewardedAdService.handleCallback — günlük sınır ve tekilleştirme', () => {
  it('aynı gün ikinci izleme (yeni transaction_id) -> ödül yok (dailyLimit 1)', async () => {
    const { run, token, fake } = await setup();
    await run(buildQuery({ custom_data: token(), transaction_id: 'tx-1' }));
    const r = await run(buildQuery({ custom_data: token(), transaction_id: 'tx-2' }));
    expect(r).toEqual({ httpStatus: 200, outcome: 'ignored_limit' });
    expect(balance(fake)).toBe(10);
    expect(fake.table('rewarded_ad_claims')).toHaveLength(1);
  });

  it('aynı transaction_id tekrar -> 200, ödül yok', async () => {
    const { run, token, fake } = await setup();
    const q = buildQuery({ custom_data: token() });
    await run(q);
    const r = await run(q);
    expect(r).toEqual({ httpStatus: 200, outcome: 'ignored_duplicate' });
    expect(balance(fake)).toBe(10);
    expect(fake.table('diamond_transactions')).toHaveLength(1);
  });

  it('dailyLimit 2: aynı transaction_id yeniden gelince İKİNCİ slot yanmaz', async () => {
    const { run, token, fake } = await setup({ dailyLimit: 2 });
    const q1 = buildQuery({ custom_data: token(), transaction_id: 'tx-1' });
    await run(q1);
    await run(q1);
    expect(balance(fake)).toBe(10);
    await run(buildQuery({ custom_data: token(), transaction_id: 'tx-2' }));
    expect(balance(fake)).toBe(20);
    expect((await run(buildQuery({ custom_data: token(), transaction_id: 'tx-3' }))).outcome).toBe('ignored_limit');
    expect(fake.table('diamond_transactions').map((t) => t.reference_id).sort()).toEqual([
      'REWARDED_AD:u1:2026-11-18:1', 'REWARDED_AD:u1:2026-11-18:2',
    ]);
  });

  it('yeni gün yeni hak verir', async () => {
    const { run, token, fake } = await setup();
    await run(buildQuery({ custom_data: token(), transaction_id: 'tx-1' }));
    const nextDay = NOW + 24 * 3600 * 1000;
    const { mod } = await import('../../src/services/rewarded-ad.service.js').then((mod) => ({ mod }));
    const r = await mod.rewardedAdService.handleCallback(
      buildQuery({ custom_data: mod.mintCustomData(U1, nextDay, SECRET), timestamp: String(nextDay), transaction_id: 'tx-2' }),
      { keys, now: () => nextDay },
    );
    expect(r.outcome).toBe('rewarded');
    expect(balance(fake)).toBe(20);
  });

  it('başka kullanıcının transaction_id’sini yeniden kullanma -> ödül yok', async () => {
    const { run, token, fake } = await setup();
    await run(buildQuery({ custom_data: token(), transaction_id: 'tx-1' }));
    const r = await run(buildQuery({ custom_data: token('u2'), user_id: ssvOf('u2'), transaction_id: 'tx-1' }));
    expect(r.outcome).toBe('ignored_conflict');
    expect(balance(fake, 'u2')).toBe(0);
  });

  it('talep yazılırken DB hatası -> fırlatır (500, Google yeniden dener), bakiye değişmez', async () => {
    const { run, token, fake } = await setup({}, {}, { failOn: [{ table: 'rewarded_ad_claims', op: 'insert', error: { message: 'x', code: '42P01' } }] });
    await expect(run(buildQuery({ custom_data: token() }))).rejects.toBeTruthy();
    expect(balance(fake)).toBe(0);
  });

  it('bakiye yazımı patlarsa talep kalır; yeniden deneme (aynı tx) ödülü TAMAMLAR, çift yatmaz', async () => {
    const { run, token, fake } = await setup({}, {}, { failOn: [{ table: 'diamond_transactions', op: 'insert', times: 1 }] });
    const q = buildQuery({ custom_data: token() });
    await expect(run(q)).rejects.toBeTruthy();
    expect(fake.table('rewarded_ad_claims')).toHaveLength(1);
    expect(balance(fake)).toBe(0);
    expect((await run(q)).outcome).toBe('rewarded'); // onarım
    expect((await run(q)).outcome).toBe('ignored_duplicate');
    expect(balance(fake)).toBe(10);
  });
});

describe('uygun olmayan kullanıcı (banlı / silinmiş / yok)', () => {
  const bad = (extra: Record<string, unknown>) => [{ id: U1, purple_diamonds: 0, purple_paid: 0, green_diamonds: 0, ...extra }];

  it.each([{ is_banned: true }, { is_deleted: true }])('SSV: %o -> 200 ama ödül yok, user_ineligible', async (flag) => {
    const { run, token, fake } = await setup({}, { users: bad(flag) });
    expect(await run(buildQuery({ custom_data: token() }))).toEqual({ httpStatus: 200, outcome: 'user_ineligible' });
    expect(balance(fake)).toBe(0);
    expect(fake.table('rewarded_ad_claims')).toHaveLength(0);
  });

  it('SSV: kullanıcı satırı yoksa ödül yok', async () => {
    const { run, token, fake } = await setup({}, { users: [] });
    expect((await run(buildQuery({ custom_data: token() }))).outcome).toBe('user_ineligible');
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it.each([{ is_banned: true }, { is_deleted: true }])('status: %o -> available=false', async (flag) => {
    const { mod } = await setup({}, { users: bad(flag) });
    expect(await mod.rewardedAdService.getStatus(U1, NOW)).toMatchObject({ available: false, customData: null });
  });
});

describe('rewardedAdService.getStatus', () => {
  it('uygunsa available=true + jeton + sıfırlanma zamanı', async () => {
    const { mod, fake } = await setup();
    const s = await mod.rewardedAdService.getStatus(U1, NOW);
    expect(s).toMatchObject({ available: true, purple: 10, resetsAt: '2026-11-19T00:00:00.000Z' });
    expect(mod.openCustomData(s.customData!, SECRET)).toEqual({ userId: U1, day: '2026-11-18' });
    expect(s.ssvUserId).toBe(mod.ssvUserId(U1, SECRET));
    expect(fake.table('diamond_transactions')).toHaveLength(0);
  });

  it('sır yoksa available=false (çökmez)', async () => {
    const { mod } = await setup();
    delete process.env.REWARDED_AD_TOKEN_SECRET;
    expect(await mod.rewardedAdService.getStatus(U1, NOW)).toMatchObject({ available: false, customData: null });
  });

  it('enabled=false, birim listesi boş, günlük limit dolu, tablo yok -> available=false', async () => {
    expect((await (await setup({ enabled: false })).mod.rewardedAdService.getStatus(U1, NOW)).available).toBe(false);
    vi.resetModules();
    process.env.REWARDED_AD_UNIT_IDS = '';
    expect((await (await setup()).mod.rewardedAdService.getStatus(U1, NOW)).available).toBe(false);
    vi.resetModules();
    process.env.REWARDED_AD_UNIT_IDS = UNIT;
    const full = await setup({}, { rewarded_ad_claims: [{ transaction_id: 't', user_id: U1, day: '2026-11-18', slot: 1, reference_id: 'r', amount: 10 }] });
    expect((await full.mod.rewardedAdService.getStatus(U1, NOW)).available).toBe(false);
    vi.resetModules();
    const broken = await setup({}, {}, { failOn: [{ table: 'rewarded_ad_claims', op: 'select', error: { message: 'x', code: '42P01' } }] });
    expect((await broken.mod.rewardedAdService.getStatus(U1, NOW)).available).toBe(false);
  });

  it('eski config satırı (rewardedAd alanı yok) parse edilir ve KAPALI sayılır', async () => {
    const { economyConfigSchema } = await import('../../src/types/economy-config.schema.js');
    const { rewardedAd: _drop, ...rewardsOld } = economyConfigFixture.rewards;
    const parsed = economyConfigSchema.parse({ ...economyConfigFixture, rewards: rewardsOld });
    expect(parsed.rewards.rewardedAd).toEqual({ enabled: false, purple: 10, dailyLimit: 1 });
    expect(() => economyConfigSchema.parse({ ...economyConfigFixture, rewards: { ...rewardsOld, rewardedAd: { purple: 51 } } })).toThrow();
    expect(() => economyConfigSchema.parse({ ...economyConfigFixture, rewards: { ...rewardsOld, rewardedAd: { dailyLimit: 6 } } })).toThrow();
  });
});

describe('rewardedAdService — Google\'a giden kimlik (gizlilik)', () => {
  const dec = (t: string) => t.split('.').map((x) => { try { return Buffer.from(x, 'base64url').toString('latin1'); } catch { return ''; } }).join('|');

  it('ssvUserId kararlı, kullanıcıya özgü, userId içermez', async () => {
    const { mod } = await setup();
    const a = mod.ssvUserId(U1, SECRET);
    expect(a).toBe(mod.ssvUserId(U1, SECRET));
    expect(a).toHaveLength(22);
    expect(a).not.toBe(mod.ssvUserId('u2', SECRET));
    expect(a).not.toBe(mod.ssvUserId(U1, SECRET + 'x'));
    expect(a).not.toContain(U1);
  });

  it('jetonda userId düz metin / base64 olarak bulunmaz; her mint farklı', async () => {
    const { token } = await setup();
    const t = token();
    expect(t).not.toContain(U1);
    expect(dec(t)).not.toContain(U1);
    expect(token()).not.toBe(t);
  });

  it('doğru akış ödül verir (user_id=ssvUserId)', async () => {
    const { run, token, fake } = await setup();
    expect((await run(buildQuery({ custom_data: token() }))).outcome).toBe('rewarded');
    expect(balance(fake)).toBe(10);
  });

  it('user_id gerçek id (takma kimlik değil) -> ödül yok', async () => {
    const { run, token, fake } = await setup();
    expect((await run(buildQuery({ custom_data: token(), user_id: U1 }))).outcome).toBe('ignored_token');
    expect((await run(buildQuery({ custom_data: token(), user_id: ssvOf('u2') }))).outcome).toBe('ignored_token');
    expect(balance(fake)).toBe(0);
  });

  it('kurcalanmış şifreli metin / etiket / mac -> ödül yok', async () => {
    const { mod, run, token, fake } = await setup();
    const [v, d, n, enc, m] = token().split('.') as [string, string, string, string, string];
    const raw = Buffer.from(enc, 'base64url');
    const flip = (i: number) => { const b = Buffer.from(raw); b[i] = b[i]! ^ 1; return b.toString('base64url'); };
    for (const bad of [flip(0), flip(14), flip(raw.length - 1)]) {
      // mac yeniden hesaplanamaz (sır yok) -> mac uyuşmaz; GCM etiketi ayrıca korur
      expect(mod.openCustomData([v, d, n, bad, m].join('.'), SECRET)).toBeNull();
      expect((await run(buildQuery({ custom_data: [v, d, n, bad, m].join('.') }))).outcome).toBe('ignored_token');
    }
    expect(mod.openCustomData([v, d, n, enc, m.slice(0, -2) + 'AA'].join('.'), SECRET)).toBeNull();
    expect(balance(fake)).toBe(0);
  });

  it('gün değiştirilmiş jeton (AAD/mac) geçmez', async () => {
    const { mod, token } = await setup();
    const [v, , n, enc, m] = token().split('.');
    expect(mod.openCustomData([v, '2026-11-17', n, enc, m].join('.'), SECRET)).toBeNull();
  });

  it('eski v1 biçimi -> 200 + ödül yok', async () => {
    const { run, fake } = await setup();
    const r = await run(buildQuery({ custom_data: 'v1.2026-11-18.abc.AAAA', user_id: U1 }));
    expect(r).toEqual({ httpStatus: 200, outcome: 'ignored_token' });
    expect(balance(fake)).toBe(0);
  });
});
