import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFakeSupabase, type Tables, type FakeSupabaseOptions } from '../helpers/fake-supabase.js';
import { SUPPORTED_LOCALES } from '../../src/constants/locales.js';

/**
 * Dil listesi — discover dil eşleşmesi ve quiz dili buradan beslenir.
 * Google Play inceleme ekibi (Hindi cihaz) iki bug'ı ortaya çıkardı (2026-09-05):
 * DB constraint'inde `hi` yoktu ve delete+insert atomik olmadığından hata anında
 * kullanıcının dilleri siliniyordu. Değişim artık tek RPC (migration 043).
 */

const UID = '11111111-1111-4111-8111-111111111111';

async function setup(seed: Tables = {}, options?: FakeSupabaseOptions) {
  const fake = createFakeSupabase(seed, options);
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { userLanguageService } = await import('../../src/services/user-language.service.js');
  return { fake, userLanguageService };
}

beforeEach(() => {
  vi.resetModules();
});

describe('setUserLanguages', () => {
  it('listeyi tek RPC çağrısıyla değiştirir (delete+insert yok)', async () => {
    const { fake, userLanguageService } = await setup({
      user_languages: [{ user_id: UID, language_code: 'tr' }],
    });

    const result = await userLanguageService.setUserLanguages(UID, ['hi', 'en']);

    expect(result).toEqual(['hi', 'en']);
    expect(fake.rpcCalls).toEqual([
      { name: 'set_user_languages', args: { p_user_id: UID, p_languages: ['hi', 'en'] } },
    ]);
    // Tabloya doğrudan dokunulmadı — atomiklik DB fonksiyonunda.
    expect(fake.table('user_languages')).toEqual([{ user_id: UID, language_code: 'tr' }]);
  });

  it('RPC hata verirse SERVER_ERROR fırlatır, mevcut liste yerinde kalır', async () => {
    const { fake, userLanguageService } = await setup(
      { user_languages: [{ user_id: UID, language_code: 'tr' }] },
      { rpc: { set_user_languages: { error: { message: 'check constraint', code: '23514' } } } },
    );

    await expect(userLanguageService.setUserLanguages(UID, ['hi'])).rejects.toMatchObject({ code: 'SERVER_ERROR', statusCode: 500 });
    expect(fake.table('user_languages')).toEqual([{ user_id: UID, language_code: 'tr' }]);
  });
});

describe('getUserLanguages', () => {
  it('kullanıcının kodlarını döner, başkasınınkini karıştırmaz', async () => {
    const { userLanguageService } = await setup({
      user_languages: [
        { user_id: UID, language_code: 'tr', created_at: '2026-09-01T00:00:00Z' },
        { user_id: UID, language_code: 'hi', created_at: '2026-09-02T00:00:00Z' },
        { user_id: 'baska', language_code: 'de', created_at: '2026-09-01T00:00:00Z' },
      ],
    });

    expect(await userLanguageService.getUserLanguages(UID)).toEqual(['tr', 'hi']);
  });
});

describe('DB constraint ↔ SUPPORTED_LOCALES paritesi', () => {
  it('migration 043 CHECK listesi sunucunun desteklediği dillerle birebir aynı', () => {
    const sql = readFileSync(new URL('../../migrations/043_user_languages_hi_atomic.sql', import.meta.url), 'utf8');
    const checkBlock = sql.match(/ADD CONSTRAINT user_languages_language_code_check[\s\S]*?\]\)\);/)?.[0];
    expect(checkBlock, 'CHECK bloğu bulunamadı').toBeDefined();

    const dbCodes = [...checkBlock!.matchAll(/'([a-z]{2})'/g)].map((m) => m[1]).sort();
    expect(dbCodes).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it('migration 044 users.locale CHECK listesi de sunucunun desteklediği dillerle birebir aynı', () => {
    // 043'ün ikizi: push dili users.locale'den okunur; DB 15 dilde kalırsa `hi` kullanıcı 500 alır.
    const sql = readFileSync(new URL('../../migrations/044_users_locale_hi.sql', import.meta.url), 'utf8');
    const checkBlock = sql.match(/ADD CONSTRAINT users_locale_check[\s\S]*?\]\)\);/)?.[0];
    expect(checkBlock, 'CHECK bloğu bulunamadı').toBeDefined();

    const dbCodes = [...checkBlock!.matchAll(/'([a-z]{2})'/g)].map((m) => m[1]).sort();
    expect(dbCodes).toEqual([...SUPPORTED_LOCALES].sort());
  });
});
