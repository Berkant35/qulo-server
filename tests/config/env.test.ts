import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `CRON_ENABLED` ayristirmasi. env.ts gecersiz degerde `process.exit(1)` cagirir — yalniz
 * cron'lar degil, butun API duser (Railway'de cokme dongusu). `.env.example`'daki yorumlu
 * `# CRON_ENABLED=` satirini oldugu gibi acan gelistirici bos deger verir; bu "tanimsiz" olmali.
 */
const ANAHTARLAR = ['CRON_ENABLED', 'RC_CONSUMABLE_WEBHOOK_CREDIT'] as const;
type Anahtar = (typeof ANAHTARLAR)[number];
let onceki: Partial<Record<Anahtar, string | undefined>> = {};

async function yukle(deger: string, anahtar: Anahtar = 'CRON_ENABLED') {
  process.env[anahtar] = deger;
  vi.resetModules();
  const exit = vi.spyOn(process, 'exit').mockImplementation(((kod?: number) => {
    throw new Error(`process.exit(${kod})`);
  }) as never);
  const hataLogu = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const { env } = await import('../../src/config/env.js');
    return { env, exit };
  } finally {
    hataLogu.mockRestore();
  }
}

beforeEach(() => {
  onceki = Object.fromEntries(ANAHTARLAR.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ANAHTARLAR) {
    if (onceki[k] === undefined) delete process.env[k];
    else process.env[k] = onceki[k];
  }
  vi.restoreAllMocks();
});

describe('env.CRON_ENABLED', () => {
  it('bos deger tanimsiz sayilir — surec cokmez, varsayilan (NODE_ENV) gecerli', async () => {
    const { env, exit } = await yukle('');
    expect(exit).not.toHaveBeenCalled();
    expect(env.CRON_ENABLED).toBeUndefined();
  });

  it('true / false aynen gecer', async () => {
    expect((await yukle('true')).env.CRON_ENABLED).toBe('true');
    expect((await yukle('false')).env.CRON_ENABLED).toBe('false');
  });

  it('anlamsiz deger hala reddedilir (sessizce yanlis yorumlanmaz)', async () => {
    await expect(yukle('evet')).rejects.toThrow('process.exit(1)');
  });
});

/**
 * Tüketilebilir webhook kredisi anahtarı — CRON_ENABLED ile aynı ayrıştırma. Varsayılan KAPALI
 * (doğrulama modu): webhook mor yatırmaz, yalnız iz satırı yazar.
 */
describe('env.RC_CONSUMABLE_WEBHOOK_CREDIT', () => {
  it('bos deger tanimsiz sayilir — surec cokmez (dogrulama modu)', async () => {
    const { env, exit } = await yukle('', 'RC_CONSUMABLE_WEBHOOK_CREDIT');
    expect(exit).not.toHaveBeenCalled();
    expect(env.RC_CONSUMABLE_WEBHOOK_CREDIT).toBeUndefined();
  });

  it('true / false aynen gecer', async () => {
    expect((await yukle('true', 'RC_CONSUMABLE_WEBHOOK_CREDIT')).env.RC_CONSUMABLE_WEBHOOK_CREDIT).toBe('true');
    expect((await yukle('false', 'RC_CONSUMABLE_WEBHOOK_CREDIT')).env.RC_CONSUMABLE_WEBHOOK_CREDIT).toBe('false');
  });

  it('anlamsiz deger hala reddedilir (sessizce yanlis yorumlanmaz)', async () => {
    await expect(yukle('evet', 'RC_CONSUMABLE_WEBHOOK_CREDIT')).rejects.toThrow('process.exit(1)');
  });
});
