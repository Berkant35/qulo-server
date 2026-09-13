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

/**
 * 2026-09-13: eşleşme `users.preferred_languages` sütununu okur, onboarding ve kayıt
 * ise yalnız `user_languages` tablosuna yazıyordu; sütun DB varsayılanı ['tr'] ile
 * kalınca yabancı kullanıcı yalnız Türkçe sorulu profilleri görüyordu (22 kullanıcı).
 * Migration 054: RPC iki yeri tek transaction'da yazar, tekilleştirir, uygulama
 * dilini her zaman listeye ekler; varsayılan boş dizi olur.
 */
describe('migration 054 — dil tercihi tek kaynak', () => {
  const sql = () =>
    readFileSync(new URL('../../migrations/054_preferred_languages_tek_kaynak.sql', import.meta.url), 'utf8');
  const fn = () => sql().match(/CREATE (?:OR REPLACE )?FUNCTION set_user_languages[\s\S]*?\$\$;/)?.[0];

  it('RPC imzası servisin gönderdiği parametre adlarıyla aynı — biri değişirse prod 42883 verir', () => {
    expect(fn(), 'fonksiyon bulunamadı').toBeDefined();
    expect(fn()).toMatch(/set_user_languages\(\s*p_user_id uuid,\s*p_languages text\[\]\s*\)/);
    expect(fn()).toMatch(/RETURNS text\[\]/);
  });

  it('RPC hem user_languages hem users.preferred_languages\'ı yazar, uygulama dilini ekler', () => {
    const f = fn()!;
    expect(f).toMatch(/DELETE FROM user_languages/);
    expect(f).toMatch(/INSERT INTO user_languages/);
    expect(f).toMatch(/UPDATE\s+users/);
    expect(f).toMatch(/SET[\s\S]{0,80}preferred_languages\s*=/);
    expect(f).toMatch(/array_append\(p_languages, v_locale\)/);
    expect(f).toMatch(/WITH ORDINALITY/); // sıra koruyan tekilleştirme
  });

  it('RPC ayrıcalık yükseltmez: SECURITY INVOKER + sabit search_path, istemci rolleri REVOKE', () => {
    expect(fn()).toMatch(/SECURITY INVOKER/);
    expect(fn()).toMatch(/SET search_path = public, pg_temp/);
    expect(sql()).toMatch(/REVOKE ALL ON FUNCTION set_user_languages\(uuid, text\[\]\) FROM PUBLIC, anon, authenticated/);
  });

  it('preferred_languages DB varsayılanı boş dizi — "tr" artefaktı bir daha üretilmez', () => {
    expect(sql()).toMatch(/ALTER COLUMN preferred_languages SET DEFAULT '\{\}'::text\[\]/);
  });

  it('migration ve rollback tek transaction (yarım uygulanma yok)', () => {
    const rb = readFileSync(new URL('../../migrations/054_preferred_languages_tek_kaynak_rollback.sql', import.meta.url), 'utf8');
    for (const text of [sql(), rb]) {
      const statements = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'));
      expect(statements[0].trim()).toBe('BEGIN;');
      expect(statements[statements.length - 1].trim()).toBe('COMMIT;');
    }
  });

  it('yedek tablo RLS + REVOKE ile kapalı (anon key ile okunamaz/silinemez)', () => {
    const s = sql();
    expect(s).toMatch(/CREATE TABLE IF NOT EXISTS _backup_054_preferred_languages/);
    expect(s).toMatch(/ALTER TABLE (?:public\.)?_backup_054_preferred_languages ENABLE ROW LEVEL SECURITY/);
    expect(s).toMatch(/REVOKE ALL ON (?:public\.)?_backup_054_preferred_languages FROM PUBLIC, anon, authenticated/);
  });

  it('veri düzeltmesi döngüyle RPC çağırır, sütun∪tablo birleşimini kullanır, artefakt tr\'yi düşürür', () => {
    const s = sql();
    expect(s).toMatch(/DO \$\$/); // CTE içinden veri değiştiren fonksiyon çağrısı yok (aynı tabloyu tarama tuzağı)
    expect(s).toMatch(/PERFORM set_user_languages/);
    expect(s).toMatch(/preferred_languages = '\{tr\}' AND (?:u\.)?locale <> 'tr'/);
    expect(s).toMatch(/has_tr_question/);
    expect(s).toMatch(/is_deleted = false/);
  });

  it('rollback yedekten geri yazar ve 043 RPC\'sine döner', () => {
    const rb = readFileSync(new URL('../../migrations/054_preferred_languages_tek_kaynak_rollback.sql', import.meta.url), 'utf8');
    expect(rb).toMatch(/FROM _backup_054_preferred_languages/);
    expect(rb).toMatch(/SET DEFAULT ARRAY\['tr'\]/);
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS set_user_languages\(uuid, text\[\]\)/);
    expect(rb).not.toMatch(/UPDATE\s+users\s+SET preferred_languages = p_languages/);
  });
});

describe('migration 055 — questions.locale CHECK ↔ SUPPORTED_LOCALES paritesi', () => {
  it('CHECK listesi sunucunun desteklediği dillerle birebir aynı (043/044 üçüzü; repo 011\'de kalmıştı)', () => {
    const sql = readFileSync(new URL('../../migrations/055_questions_locale_check_hi.sql', import.meta.url), 'utf8');
    const arr = sql.match(/ADD CONSTRAINT questions_locale_check[\s\S]*?ARRAY\[([\s\S]*?)\]/)?.[1];
    expect(arr, 'CHECK bloğu bulunamadı').toBeDefined();
    const dbCodes = arr!.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean).sort();
    expect(dbCodes).toEqual([...SUPPORTED_LOCALES].sort());
  });
});

describe('languagesToSync — PATCH sonrası senkron listesi (saf kural)', () => {
  const rule = async () => (await setup()).userLanguageService.languagesToSync;

  it('preferred_languages yoksa ve locale zaten listedeyse null (senkron gereksiz)', async () => {
    expect((await rule())({ locale: 'fr' }, ['tr', 'fr'])).toBeNull();
  });

  it('yalnız locale geldiyse mevcut liste + locale', async () => {
    expect((await rule())({ locale: 'fr' }, ['tr'])).toEqual(['tr', 'fr']);
    expect((await rule())({ locale: 'fr' }, null)).toEqual(['fr']);
  });

  it('liste geldiyse locale eksikse sona eklenir, tekrarlar sıra korunarak düşer', async () => {
    expect((await rule())({ preferred_languages: ['en', 'tr', 'en'], locale: 'de' }, ['tr'])).toEqual(['en', 'tr', 'de']);
  });

  it('hiçbiri gelmediyse null', async () => {
    expect((await rule())({}, ['tr'])).toBeNull();
  });
});
