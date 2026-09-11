import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type Tables } from '../helpers/fake-supabase.js';

/**
 * Profil detayindaki mesafe: iki tarafin da koordinati varsa km (1 ondalik),
 * yoksa NULL. Eskiden bilinmeyen mesafe 0 (hatta NaN) donuyor, istemci bunu
 * "yakinda" diye gosteriyordu — yanlis bilgi.
 */

const ME = '11111111-1111-4111-8111-111111111111';
const HER = '22222222-2222-4222-8222-222222222222';

const user = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: 'Ada', age: 27, bio: null, city: null, country: null, photos: [],
  relationship_goal: null, is_online: false, last_seen_at: null, profile_completion: 50,
  boost_until: null, lat: 41.0, lng: 29.0, passport_lat: null, passport_lng: null,
  is_deleted: false, ...over,
});

async function setup(seed: Tables) {
  const fake = createFakeSupabase({
    users: [], blocks: [], user_details: [], matches: [], questions: [], ...seed,
  });
  vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
  const { userService } = await import('../../src/services/user.service.js');
  return { fake, userService };
}

beforeEach(() => {
  vi.resetModules();
});

describe('userService.getPublicProfile — distance_km', () => {
  it('iki tarafin da konumu varsa km hesaplar, 1 ondalik', async () => {
    const { userService } = await setup({ users: [user(ME), user(HER, { lng: 29.1 })] });

    const profile = await userService.getPublicProfile(ME, HER);

    // 41° enleminde 0.1° boylam farki ≈ 8.4 km (haversine).
    expect(profile.distance_km).toBe(8.4);
  });

  it('hedefin konumu yoksa null — "yakinda" yanilgisi olmasin', async () => {
    const { userService } = await setup({ users: [user(ME), user(HER, { lat: null, lng: null })] });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.distance_km).toBeNull();
  });

  it('istekcinin konumu yoksa null', async () => {
    const { userService } = await setup({ users: [user(ME, { lat: null, lng: null }), user(HER)] });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.distance_km).toBeNull();
  });

  it('pasaport yarim kayitliysa (sadece lat) gercek konumdan olcer — melez nokta yok', async () => {
    const { userService } = await setup({
      users: [user(ME, { passport_lat: 52.0, passport_lng: null }), user(HER, { lng: 29.1 })],
    });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.distance_km).toBe(8.4);
  });

  it('pasaport konumu varsa oradan olcer', async () => {
    const { userService } = await setup({
      users: [user(ME, { passport_lat: 41.0, passport_lng: 29.1 }), user(HER)],
    });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.distance_km).toBe(8.4);
  });
});

/**
 * Cevrimici durum ve son gorulme yalnizca AKTIF eslesmeye acik. Eslesmedigin
 * birinin ne zaman cevrimici oldugunu gorebilmek takip araci olur — bu sinir
 * veri sizintisi sinifinda, kod dogru; testler onu donduruyor.
 */
describe('userService.getPublicProfile — cevrimici durum gizliligi', () => {
  const OTHER = '33333333-3333-4333-8333-333333333333';
  const SEEN = '2026-09-10T10:00:00.000Z';
  const onlineHer = () => user(HER, { is_online: true, last_seen_at: SEEN });
  const match = (user1_id: string, user2_id: string, is_active = true) => ({
    id: `m-${user1_id.slice(0, 4)}-${user2_id.slice(0, 4)}`, user1_id, user2_id, is_active,
  });

  it('eslesme yoksa is_online ve last_seen null — hedef cevrimici olsa bile', async () => {
    const { userService } = await setup({ users: [user(ME), onlineHer()] });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.is_online).toBeNull();
    expect(profile.last_seen).toBeNull();
  });

  it('aktif eslesmede gercek degerler doner', async () => {
    const { userService } = await setup({
      users: [user(ME), onlineHer()], matches: [match(ME, HER)],
    });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.is_online).toBe(true);
    expect(profile.last_seen).toBe(SEEN);
  });

  it('eslesme ters yonde kayitliysa da (user1 = hedef) gorunur', async () => {
    const { userService } = await setup({
      users: [user(ME), onlineHer()], matches: [match(HER, ME)],
    });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.is_online).toBe(true);
    expect(profile.last_seen).toBe(SEEN);
  });

  it('bitmis (pasif) eslesme durumu acmaz', async () => {
    const { userService } = await setup({
      users: [user(ME), onlineHer()], matches: [match(ME, HER, false)],
    });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.is_online).toBeNull();
    expect(profile.last_seen).toBeNull();
  });

  it('iki tarafin BASKALARIYLA eslesmesi durumu acmaz', async () => {
    // Filtre "iki taraf birlikte" yerine "taraflardan biri" diye yazilirsa
    // hedefin ya da izleyicinin herhangi bir eslesmesi kapiyi acar.
    const { userService } = await setup({
      users: [user(ME), onlineHer(), user(OTHER)],
      matches: [match(OTHER, HER), match(ME, OTHER)],
    });

    const profile = await userService.getPublicProfile(ME, HER);

    expect(profile.is_online).toBeNull();
    expect(profile.last_seen).toBeNull();
  });
});

/**
 * getMe.question_locales — kullanicinin sorularinin dil dagilimi.
 *
 * Kesif, bir profili yalnizca izleyicinin okudugu dillerde en az iki sorusu
 * varsa gosteriyor (matching.service.ts 5.6). Bu alan kullaniciya sorularini
 * hangi dillerde yazdigini gosterir — BILGI, teshis degil.
 *
 * Ondan "kimseye gorunmuyorsun" sonucu cikarilamaz: sunucu kurali dil basina
 * degil TOPLAM sayiyor, yani izleyici tr+en okuyorsa {tr:1, en:1} olan profil
 * filtreyi gecer. Bu dosyada bir test daha once tam bu yanlis iddiayi
 * donduruyordu; duzeltildi.
 */
describe('userService.getMe — question_locales', () => {
  const meRow = (over: Record<string, unknown> = {}) => ({
    id: ME, email: 'a@b.test', name: 'Ada', question_count: 0, is_deleted: false, ...over,
  });

  it('dil basina soru sayisini dondurur', async () => {
    const { userService } = await setup({
      users: [meRow({ question_count: 4 })],
      questions: [
        { user_id: ME, locale: 'tr' },
        { user_id: ME, locale: 'tr' },
        { user_id: ME, locale: 'en' },
        { user_id: ME, locale: 'de' },
      ],
    });

    const me = await userService.getMe(ME);

    expect(me.question_locales).toEqual({ tr: 2, en: 1, de: 1 });
  });

  it('sorusu olmayan kullanicida bos nesne doner, undefined degil', async () => {
    const { userService } = await setup({ users: [meRow()], questions: [] });

    const me = await userService.getMe(ME);

    // Istemci `Object.values(...).some(n => n >= 2)` yapiyor; undefined patlatirdi.
    expect(me.question_locales).toEqual({});
  });

  it('baska kullanicinin sorulari sayima girmez', async () => {
    const { userService } = await setup({
      users: [meRow({ question_count: 1 })],
      questions: [
        { user_id: ME, locale: 'tr' },
        { user_id: HER, locale: 'en' },
        { user_id: HER, locale: 'en' },
      ],
    });

    const me = await userService.getMe(ME);

    expect(me.question_locales).toEqual({ tr: 1 });
  });

  it('locale bos gelen eski satirlar tr sayilir — matching ile ayni fallback', async () => {
    // matching.service.ts:189 ve :409 da `|| 'tr'` yapiyor. Iki taraf ayrisirsa
    // istemci "gorunuyorsun" derken kesif tersini uygular.
    const { userService } = await setup({
      users: [meRow({ question_count: 2 })],
      questions: [
        { user_id: ME, locale: null },
        { user_id: ME, locale: 'tr' },
      ],
    });

    const me = await userService.getMe(ME);

    expect(me.question_locales).toEqual({ tr: 2 });
  });

  it('uc soru uc ayri dilde: dagilim dogru, ama bundan gorunmezlik CIKARILAMAZ', async () => {
    // Bu testin daha once yanlis bir iddiasi vardi: "hicbir dilde iki soru yoksa
    // profil hic kimseye ulasmiyor". Sunucu kurali dil basina degil TOPLAM
    // sayiyor (matching.service.ts:242) — izleyici tr+en okuyorsa {tr:1,en:1}
    // filtreyi gecer. Alan bir bilgi, teshis degil.
    const { userService } = await setup({
      users: [meRow({ question_count: 3 })],
      questions: [
        { user_id: ME, locale: 'tr' },
        { user_id: ME, locale: 'en' },
        { user_id: ME, locale: 'de' },
      ],
    });

    const me = await userService.getMe(ME);

    expect(me.question_locales).toEqual({ tr: 1, en: 1, de: 1 });
    // Toplam, question_count ile tutarli olmali — istemci ikisini birlikte gosteriyor.
    const total = Object.values(me.question_locales!).reduce((a, b) => a + b, 0);
    expect(total).toBe(me.question_count);
  });
});

describe('userService.getMe — question_locales hata dali', () => {
  it('sorgu patlarsa alan undefined doner, bos nesne DEGIL', async () => {
    // Bos nesne "hicbir dilde iki soru yok" demek; istemci bunu gorunmezlik
    // uyarisina cevirir. Yani bir DB hatasi, kullaniciya profili hakkinda
    // yanlis bir teshis olarak gorunurdu. Ayrim onemli.
    const fake = createFakeSupabase({
      users: [{ id: ME, email: 'a@b.test', name: 'Ada', question_count: 2, is_deleted: false }],
      user_details: [], questions: [{ user_id: ME, locale: 'tr' }, { user_id: ME, locale: 'tr' }],
    }, { failOn: [{ table: 'questions', op: 'select' }] });
    vi.doMock('../../src/config/supabase.js', () => ({ supabase: fake.client }));
    const { userService } = await import('../../src/services/user.service.js');

    const me = await userService.getMe(ME);

    expect(me.question_locales).toBeUndefined();
    // getMe'nin geri kalani calismaya devam etmeli — yan bilgi, profili dusurmez.
    expect(me.id).toBe(ME);
    expect(me.question_count).toBe(2);
  });
});
