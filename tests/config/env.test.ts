import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `CRON_ENABLED` ayristirmasi. env.ts gecersiz degerde `process.exit(1)` cagirir — yalniz
 * cron'lar degil, butun API duser (Railway'de cokme dongusu). `.env.example`'daki yorumlu
 * `# CRON_ENABLED=` satirini oldugu gibi acan gelistirici bos deger verir; bu "tanimsiz" olmali.
 */
let onceki: string | undefined;

async function yukle(deger: string) {
  process.env.CRON_ENABLED = deger;
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

beforeEach(() => { onceki = process.env.CRON_ENABLED; });
afterEach(() => {
  if (onceki === undefined) delete process.env.CRON_ENABLED;
  else process.env.CRON_ENABLED = onceki;
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
