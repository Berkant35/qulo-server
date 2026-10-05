import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeSupabase, type FakeSupabase, type FakeSupabaseOptions, type Tables } from "../helpers/fake-supabase.js";

const VIEWER_ID = "00000000-0000-4000-8000-000000000001";

/** Deterministik test UUID'si. */
function uid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** Istanbul merkezli izleyici; radius 50 km, herkesi gormek istiyor. */
function viewerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VIEWER_ID,
    gender: "MAN",
    gender_pref: "BOTH",
    // Kurulumu bitmis izleyici: tercih SECILMIS (discover set_at bos iken deste kurmaz).
    gender_pref_set_at: "2026-09-01T00:00:00Z",
    pref_consent_status: null,
    age_pref_min: 18,
    age_pref_max: 99,
    match_radius_km: 50,
    lat: 41.0,
    lng: 29.0,
    passport_lat: null,
    passport_lng: null,
    preferred_languages: ["tr"],
    is_test_admin: false,
    is_deleted: false,
    email_verified: true,
    is_test_account: false,
    photos: ["me.jpg"],
    ...overrides,
  };
}

/**
 * Aday uretici. `kmAway` kuzey yonunde kaydirir (1 derece enlem ~111 km),
 * boylece mesafe testleri haversine'i gercekten kullanir.
 */
function candidateRow(id: string, kmAway: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `user-${id}`,
    bio: "bio",
    age: 30,
    gender: "WOMAN",
    city: "Istanbul",
    lat: 41.0 + kmAway / 111,
    lng: 29.0,
    photos: ["p1.jpg"],
    profile_completion: 80,
    green_diamonds: 0,
    like_received_count: 0,
    times_shown_count: 0,
    last_seen_at: new Date().toISOString(),
    boost_until: null,
    relationship_goal: "SERIOUS",
    is_deleted: false,
    is_banned: false,
    email_verified: true,
    is_test_account: false,
    ...overrides,
  };
}

/** Her adaya kullanicinin dilinde 2 soru verir (dil kapisini gecsin diye). */
function questionsFor(userIds: string[], locale = "tr") {
  return userIds.flatMap((uid) => [
    { user_id: uid, category: "life", stats_correct: 0, stats_wrong: 0, locale },
    { user_id: uid, category: "life", stats_correct: 0, stats_wrong: 0, locale },
  ]);
}

/** Son `loadService` cagrisinin sahte istemcisi — rpc/tablo istek sayisi iddialari icin. */
let sonFake: FakeSupabase;

async function loadService(
  tables: Tables,
  opts: {
    userLanguages?: string[];
    failOn?: Array<Record<string, unknown>>;
    rpc?: FakeSupabaseOptions["rpc"];
    /** app_config.discover_dormant_days (migration 074); varsayilan 14. */
    dormantDays?: number;
    /** app_config.mutual_match_enabled (migration 075); varsayilan kapali. */
    mutual?: boolean;
    /** economy.quizOnboarding.failedRetryDays; varsayilan 7. */
    retryDays?: number;
    incrementDailySwipes?: () => Promise<void>;
    incrementDailyUndos?: () => Promise<void>;
  } = {},
) {
  vi.resetModules();
  const fake = createFakeSupabase(tables, {
    rpc: { increment_times_shown: { data: null }, increment_like_received: { data: null }, ...opts.rpc },
    ...(opts.failOn ? { failOn: opts.failOn as never } : {}),
  });
  sonFake = fake;
  vi.doMock("../../src/config/supabase.js", () => ({ supabase: fake.client }));
  vi.doMock("../../src/services/block.service.js", () => ({
    blockService: { getBlockedIds: async () => [], getBlockerIds: async () => [] },
  }));
  vi.doMock("../../src/services/user-language.service.js", () => ({
    userLanguageService: { getUserLanguages: async () => opts.userLanguages ?? ["tr"] },
  }));
  vi.doMock("../../src/services/app-config.service.js", () => ({
    appConfigService: {
      getDiscoverDormantDays: async () => opts.dormantDays ?? 14,
      getMutualMatchEnabled: async () => opts.mutual ?? false,
    },
  }));
  vi.doMock("../../src/services/economy-config.service.js", () => ({
    economyConfigService: { getConfig: async () => ({ quizOnboarding: { failedRetryDays: opts.retryDays ?? 7 } }) },
  }));
  vi.doMock("../../src/services/subscription.service.js", () => ({
    subscriptionService: {
      incrementDailyUndos: opts.incrementDailyUndos ?? (async () => undefined),
      incrementDailySwipes: opts.incrementDailySwipes ?? (async () => undefined),
    },
  }));
  const mod = await import("../../src/services/matching.service.js");
  return mod.matchingService;
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe("getMatches — son mesaj onizlemesi dili", () => {
  // Eskiden ses/foto onizlemesi her dilde sabit Turkceydi ("🎤 Sesli mesaj");
  // mobil eslesme listesi metni oldugu gibi gosteriyor.
  const OTHER = uid(2);
  const MATCH = "match-1";
  const tables: Tables = {
    users: [viewerRow(), candidateRow(OTHER, 1, { is_online: false })],
    matches: [
      { id: MATCH, user1_id: VIEWER_ID, user2_id: OTHER, matched_at: "2026-09-14T08:00:00Z", is_active: true },
    ],
  };

  /** `match_list_summaries` (migration 070) ozet satiri; son mesaj SECIMI SQL sinamasinda. */
  function ozet(alanlar: Record<string, unknown>): { rpc: FakeSupabaseOptions["rpc"] } {
    return {
      rpc: {
        match_list_summaries: {
          data: [{
            match_id: MATCH, content: "icerik", sender_id: OTHER, is_image: false, audio_url: null,
            created_at: "2026-09-14T09:00:00Z", unread_count: 0, ...alanlar,
          }],
        },
      },
    };
  }

  it("sesli mesaj istenen dilde", async () => {
    const service = await loadService(tables, ozet({ audio_url: "https://cdn.example/a.m4a", content: "Sesli mesaj" }));

    const [en] = await service.getMatches(VIEWER_ID, "en");
    const [de] = await service.getMatches(VIEWER_ID, "de");

    expect(en.last_message).toBe("🎤 Voice message");
    expect(de.last_message).toBe("🎤 Sprachnachricht");
  });

  it("foto istenen dilde", async () => {
    const service = await loadService(tables, ozet({ is_image: true, content: "https://cdn.example/p.jpg" }));

    const [ja] = await service.getMatches(VIEWER_ID, "ja");

    expect(ja.last_message).toBe("📷 写真");
  });

  it("header gondermeyen eski istemci (tr) eskisiyle ayni metni gorur", async () => {
    const service = await loadService(tables, ozet({ audio_url: "https://cdn.example/a.m4a" }));

    const [tr] = await service.getMatches(VIEWER_ID, "tr");

    expect(tr.last_message).toBe("🎤 Sesli mesaj");
  });

  it("metin mesaji cevrilmez, oldugu gibi doner", async () => {
    const service = await loadService(tables, ozet({ content: "selam nasilsin" }));

    const [en] = await service.getMatches(VIEWER_ID, "en");

    expect(en.last_message).toBe("selam nasilsin");
  });
});

describe("getMatches — eslesme basina tek ozet (migration 070)", () => {
  // Eskiden tum eslesmelerin TUM mesajlari cekiliyordu: egress sohbet gecmisiyle sinirsiz
  // buyuyor, PostgREST max-rows (1000) sonrasini sessizce kesiyordu (2026-09-28 maliyet incelemesi).
  const OTHER = uid(2);
  const OTHER2 = uid(3);
  const M1 = "match-1";
  const M2 = "match-2";
  const tables: Tables = {
    users: [viewerRow(), candidateRow(OTHER, 1), candidateRow(OTHER2, 2)],
    matches: [
      { id: M1, user1_id: VIEWER_ID, user2_id: OTHER, matched_at: "2026-09-14T08:00:00Z", is_active: true },
      { id: M2, user1_id: OTHER2, user2_id: VIEWER_ID, matched_at: "2026-09-13T08:00:00Z", is_active: true },
    ],
    // RPC'ye gecildiyse bu satirlar HIC okunmamali (asagidaki istek iddiasi).
    messages: [{ match_id: M1, sender_id: OTHER, content: "tablodan", is_image: false, audio_url: null, read_at: null, deleted_at: null, created_at: "2026-09-14T09:00:00Z" }],
  };

  it("RPC kullanici ve eslesme id'leriyle cagrilir; messages tablosu hic okunmaz", async () => {
    const service = await loadService(tables, { rpc: { match_list_summaries: { data: [] } } });

    await service.getMatches(VIEWER_ID, "tr");

    expect(sonFake.rpcCalls).toContainEqual({
      name: "match_list_summaries",
      args: { p_user_id: VIEWER_ID, p_match_ids: [M1, M2] },
    });
    expect(sonFake.queries.filter((q) => q.table === "messages")).toEqual([]);
  });

  it("son mesaj, gonderen, zaman ve okunmamis sayisi ozetten gelir", async () => {
    const service = await loadService(tables, {
      rpc: {
        match_list_summaries: {
          data: [{ match_id: M2, content: "merhaba", sender_id: OTHER2, is_image: false, audio_url: null, created_at: "2026-09-14T10:00:00Z", unread_count: 3 }],
        },
      },
    });

    const liste = await service.getMatches(VIEWER_ID, "tr");
    const m2 = liste.find((m) => m.match_id === M2)!;

    expect(m2).toMatchObject({
      last_message: "merhaba",
      last_message_sender_id: OTHER2,
      last_message_sent_at: "2026-09-14T10:00:00Z",
      unread_count: 3,
    });
  });

  it("mesajsiz eslesme (ozet alanlari NULL) ve ozeti hic gelmeyen eslesme: onizleme null, okunmamis 0", async () => {
    const service = await loadService(tables, {
      rpc: {
        match_list_summaries: {
          data: [{ match_id: M1, content: null, sender_id: null, is_image: null, audio_url: null, created_at: null, unread_count: 0 }],
        },
      },
    });

    const liste = await service.getMatches(VIEWER_ID, "tr");

    expect(liste).toHaveLength(2);
    for (const m of liste) {
      expect(m).toMatchObject({ last_message: null, last_message_sent_at: null, last_message_sender_id: null, unread_count: 0 });
    }
  });

  it("karsi kullanicilar okunamazsa SERVER_ERROR firlatilir ve loglanir (sessiz user: null yok)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = await loadService(tables, {
      rpc: { match_list_summaries: { data: [] } },
      failOn: [{ table: "users", op: "select" }],
    });

    await expect(service.getMatches(VIEWER_ID, "tr")).rejects.toMatchObject({ code: "SERVER_ERROR" });
    expect(log).toHaveBeenCalledWith("[matching] getMatches users error:", expect.any(String));
  });

  it("RPC hatasi: liste yine doner (onizlemesiz) ve hata loglanir", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = await loadService(tables, {
      rpc: { match_list_summaries: { error: { message: "function match_list_summaries does not exist" } } },
    });

    const liste = await service.getMatches(VIEWER_ID, "tr");

    expect(liste.map((m) => m.match_id)).toEqual([M1, M2]);
    expect(liste.every((m) => m.last_message === null && m.unread_count === 0)).toBe(true);
    expect(log).toHaveBeenCalledWith("[matching] match_list_summaries error:", "function match_list_summaries does not exist");
  });
});

describe("discover — aday sorgusu", () => {
  it("50'den fazla uygun aday varken 50. siradan sonrakiler de gorunur", async () => {
    // 60 aday: hepsi radius icinde, hepsi uygun. Eski kod sorguyu 50'de
    // SIRALAMASIZ kesiyordu; kalan 10 aday hicbir sayfada gorunmuyordu.
    const ids = Array.from({ length: 60 }, (_, i) => `cand-${String(i).padStart(2, "0")}`);
    const service = await loadService({
      users: [viewerRow(), ...ids.map((id, i) => candidateRow(id, 1 + i * 0.5))],
      swipes: [],
      matches: [],
      questions: questionsFor(ids),
    });

    const seen = new Set<string>();
    for (let page = 1; page <= 7; page++) {
      const res = await service.discover(VIEWER_ID, page);
      for (const c of res.cards) seen.add(c.user_id);
    }

    expect(seen.size).toBe(60);
    expect(seen.has("cand-55")).toBe(true);
  });

  it("swipe edilmis aday hicbir sayfada donmez", async () => {
    // Gercek UUID'ler: dislama SORGUDA yapiliyor ve PostgREST `in` sozdizimi
    // ancak boylece test ediliyor (fake, parantezsiz/dizi degeri reddediyor).
    const ids = [uid(10), uid(11), uid(12)];
    const service = await loadService({
      users: [viewerRow(), ...ids.map((id, i) => candidateRow(id, 5 + i))],
      swipes: [{ swiper_id: VIEWER_ID, target_id: ids[1], action: "LIKE" }],
      matches: [],
      questions: questionsFor(ids),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).not.toContain(ids[1]);
    expect(res.cards).toHaveLength(2);
  });

  // 2026-10-04 "once iceri al": giris dogrulamasiz, havuz kucuk → dogrulanmamis kullanici da
  // gorunur. Kotuye kullanim kapisi yazmada (emailVerifiedGuard), gorunurlukte degil.
  it("e-postasi dogrulanmamis aday da havuzda gorunur", async () => {
    const ids = [uid(30), uid(31)];
    const service = await loadService({
      users: [viewerRow(), candidateRow(ids[0], 3), candidateRow(ids[1], 4, { email_verified: false })],
      swipes: [],
      matches: [],
      questions: questionsFor(ids),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id).sort()).toEqual([...ids].sort());
  });

  it("sayfa sonuna gelmek empty_reason uretmez", async () => {
    // Havuz dolu ama istenen sayfa bos: bu bir HAVUZ sebebi degil.
    const ids = [uid(20), uid(21)];
    const service = await loadService({
      users: [viewerRow(), ...ids.map((id, i) => candidateRow(id, 5 + i))],
      swipes: [],
      matches: [],
      questions: questionsFor(ids),
    });

    const res = await service.discover(VIEWER_ID, 3);
    expect(res.cards).toHaveLength(0);
    expect(res.empty_reason).toBeUndefined();
  });
});

describe("discover — cinsiyet tercihi (prod 29 Eyl-3 Eki: erkege erkek kart)", () => {
  // Mobil complete-profile'dan hemen sonra discover'i onceden cekiyor; tercih adimi
  // sonra geliyor. O anda gender_pref DB varsayilani 'BOTH' ve set_at bos — filtresiz
  // deste donuyor, tercih secildikten sonra da yenilenmiyordu.
  const tablolar = (izleyici: Record<string, unknown>): Tables => ({
    users: [
      viewerRow(izleyici),
      candidateRow(uid(30), 3, { gender: "WOMAN" }),
      candidateRow(uid(31), 4, { gender: "MAN" }),
    ],
    swipes: [],
    matches: [],
    questions: questionsFor([uid(30), uid(31)]),
  });

  it("tercih secilmemisse (varsayilan BOTH, set_at bos) deste kurulmaz: PROFILE_INCOMPLETE", async () => {
    const service = await loadService(tablolar({ gender_pref: "BOTH", gender_pref_set_at: null }));

    await expect(service.discover(VIEWER_ID, 1)).rejects.toMatchObject({ code: "PROFILE_INCOMPLETE" });
    // Aday sorgusu hic atilmaz: yalniz izleyici satiri okunur.
    const kullaniciOkumalari = sonFake.queries.filter((q) => q.table === "users" && q.op === "select");
    expect(kullaniciOkumalari).toHaveLength(1);
    expect(sonFake.queries.some((q) => q.table === "questions")).toBe(false);
  });

  it("tercih WOMAN secilmisse yalniz kadin adaylar doner", async () => {
    const service = await loadService(tablolar({ gender_pref: "WOMAN" }));
    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual([uid(30)]);
  });

  it("bilerek BOTH secilmisse (set_at dolu) iki cinsiyet de doner", async () => {
    const service = await loadService(tablolar({ gender_pref: "BOTH" }));
    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id).sort()).toEqual([uid(30), uid(31)]);
  });
});

describe("discover — karşılıklı eşleşme (mutual_match_enabled, spec 2026-10-05)", () => {
  const HETERO_MAN = uid(60), GAY_MAN = uid(61), BI_MAN = uid(62), HETERO_WOMAN = uid(63),
    LESBIAN = uid(64), DECLINED_WOMAN = uid(65), OTHER_ALL = uid(66), SEED_HETERO_MAN = uid(67), SEED_GAY_MAN = uid(68);
  const ids = [HETERO_MAN, GAY_MAN, BI_MAN, HETERO_WOMAN, LESBIAN, DECLINED_WOMAN, OTHER_ALL, SEED_HETERO_MAN, SEED_GAY_MAN];
  const seed = { is_seed_profile: true, is_test_account: true };
  const tablolar = (izleyici: Record<string, unknown>): Tables => ({
    users: [
      viewerRow(izleyici),
      candidateRow(HETERO_MAN, 1, { gender: "MAN", gender_pref: "WOMAN" }),
      candidateRow(GAY_MAN, 2, { gender: "MAN", gender_pref: "MAN" }),
      candidateRow(BI_MAN, 3, { gender: "MAN", gender_pref: "BOTH" }),
      candidateRow(HETERO_WOMAN, 4, { gender: "WOMAN", gender_pref: "MAN" }),
      candidateRow(LESBIAN, 5, { gender: "WOMAN", gender_pref: "WOMAN" }),
      candidateRow(DECLINED_WOMAN, 6, { gender: "WOMAN", gender_pref: null }),
      candidateRow(OTHER_ALL, 7, { gender: "OTHER", gender_pref: "BOTH" }),
      candidateRow(SEED_HETERO_MAN, 8, { gender: "MAN", gender_pref: "WOMAN", ...seed }),
      candidateRow(SEED_GAY_MAN, 9, { gender: "MAN", gender_pref: "MAN", ...seed }),
    ],
    swipes: [],
    matches: [],
    questions: questionsFor(ids),
  });
  const kartlar = async (izleyici: Record<string, unknown>, mutual = true) => {
    const service = await loadService(tablolar(izleyici), { mutual });
    return (await service.discover(VIEWER_ID, 1)).cards.map((c) => c.user_id).sort();
  };

  it("hetero kadın: erkek arayan erkekleri görmez (gey erkek + gey seed dışarıda)", async () => {
    expect(await kartlar({ gender: "WOMAN", gender_pref: "MAN" }))
      .toEqual([HETERO_MAN, BI_MAN, SEED_HETERO_MAN].sort());
  });

  it("test admin olmayan gey erkek: gey seed'i görür, hetero seed'i görmez (iki .or grubu birlikte)", async () => {
    expect(await kartlar({ gender: "MAN", gender_pref: "MAN", is_test_admin: false }))
      .toEqual([GAY_MAN, BI_MAN, SEED_GAY_MAN].sort());
  });

  it("lezbiyen: yalnız kadın arayan ya da herkesi arayan kadınlar", async () => {
    expect(await kartlar({ gender: "WOMAN", gender_pref: "WOMAN" }))
      .toEqual([LESBIAN, DECLINED_WOMAN].sort());
  });

  it("rızasını reddetmiş erkek (tercih NULL, set_at NULL) kapıyı geçer, kendisini kabul eden herkesi görür", async () => {
    expect(await kartlar({ gender: "MAN", gender_pref: null, gender_pref_set_at: null, pref_consent_status: "DECLINED" }))
      .toEqual([GAY_MAN, BI_MAN, HETERO_WOMAN, DECLINED_WOMAN, OTHER_ALL, SEED_GAY_MAN].sort());
  });

  it("OTHER izleyici (herkes): yalnız herkesi arayanlar", async () => {
    expect(await kartlar({ gender: "OTHER", gender_pref: "BOTH" }))
      .toEqual([BI_MAN, DECLINED_WOMAN, OTHER_ALL].sort());
  });

  it("cinsiyeti NULL izleyici: PROFILE_INCOMPLETE", async () => {
    const service = await loadService(tablolar({ gender: null, gender_pref: "BOTH" }), { mutual: true });
    await expect(service.discover(VIEWER_ID, 1)).rejects.toMatchObject({ code: "PROFILE_INCOMPLETE" });
  });

  it("anahtar kapalı: eski tek yönlü davranış (hetero kadın gey erkeği de görür)", async () => {
    expect(await kartlar({ gender: "WOMAN", gender_pref: "MAN" }, false))
      .toEqual([HETERO_MAN, GAY_MAN, BI_MAN, SEED_HETERO_MAN, SEED_GAY_MAN].sort());
  });

  it("anahtar kapalıyken de DECLINED izleyici kapıyı geçer (tercih NULL = BOTH)", async () => {
    const cards = await kartlar({ gender: "MAN", gender_pref: null, gender_pref_set_at: null, pref_consent_status: "DECLINED" }, false);
    expect(cards).toHaveLength(ids.length);
  });
});

describe("discover — uyuyan hesaplar sona (prod 29 Eyl-3 Eki: yanitsiz eslesmeler)", () => {
  const gunOnce = (gun: number) => new Date(Date.now() - gun * 24 * 60 * 60 * 1000).toISOString();
  const UYUYAN_YAKIN = uid(40);
  const AKTIF_UZAK = uid(41);
  const tablolar = (ek: Array<Record<string, unknown>> = []): Tables => ({
    users: [
      viewerRow(),
      // Yakin (tier 0) ama 60 gundur gorulmuyor.
      candidateRow(UYUYAN_YAKIN, 2, { last_seen_at: gunOnce(60) }),
      // Uzak (radius 50 km disi, tier >= 1) ama dun gorulmus.
      candidateRow(AKTIF_UZAK, 120, { last_seen_at: gunOnce(1) }),
      ...ek,
    ],
    swipes: [],
    matches: [],
    questions: questionsFor([UYUYAN_YAKIN, AKTIF_UZAK, ...ek.map((r) => r.id as string)]),
  });

  it("esikten uzun suredir gorulmeyen yakin aday, aktif uzak adayin ARKASINDA kalir", async () => {
    const service = await loadService(tablolar());
    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual([AKTIF_UZAK, UYUYAN_YAKIN]);
  });

  it("esik 0 ise siralama kapali: yakin aday once (eski davranis)", async () => {
    const service = await loadService(tablolar(), { dormantDays: 0 });
    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual([UYUYAN_YAKIN, AKTIF_UZAK]);
  });

  it("esik config'ten gelir: 90 gun esikte 60 gunluk aday uyuyan sayilmaz", async () => {
    const service = await loadService(tablolar(), { dormantDays: 90 });
    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual([UYUYAN_YAKIN, AKTIF_UZAK]);
  });

  it("havuzda yalniz uyuyanlar varsa Discover BOSALMAZ — sert filtre degil", async () => {
    const ids = [uid(42), uid(43)];
    const service = await loadService({
      users: [viewerRow(), ...ids.map((id, i) => candidateRow(id, 3 + i, { last_seen_at: gunOnce(100) }))],
      swipes: [],
      matches: [],
      questions: questionsFor(ids),
    });
    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual(ids);
    expect(res.empty_reason).toBeUndefined();
  });

  it("last_seen_at bos aday uyuyan sayilir ama listede kalir", async () => {
    const BOS = uid(44);
    const service = await loadService(tablolar([candidateRow(BOS, 1, { last_seen_at: null })]));
    const res = await service.discover(VIEWER_ID, 1);
    const sira = res.cards.map((c) => c.user_id);
    expect(sira[0]).toBe(AKTIF_UZAK);
    expect(sira).toContain(BOS);
  });

  // Bilincli davranis degisikligi (3 Eki): yanit veren seed, yanit vermeyecek uyuyan gercek adayin onunde.
  // Sira: aktif gercek -> seed -> uyuyan gercek.
  it("seed profil uyuyan gercek adayin ONUNDE, aktif gercek adayin ARKASINDA", async () => {
    const SEED = uid(45);
    const service = await loadService(tablolar([candidateRow(SEED, 1, { is_seed_profile: true, is_test_account: true })]));
    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual([AKTIF_UZAK, SEED, UYUYAN_YAKIN]);
  });

  it("seed'in kendi last_seen_at'i eski olsa da seed grubunda kalir (uyuyanlarla karismaz)", async () => {
    const SEED_ESKI = uid(46);
    const service = await loadService(
      tablolar([candidateRow(SEED_ESKI, 200, { is_seed_profile: true, is_test_account: true, last_seen_at: gunOnce(90) })]),
    );
    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual([AKTIF_UZAK, SEED_ESKI, UYUYAN_YAKIN]);
  });

  it("esik 0 (uyuyan siralamasi kapali) ise gercekler yine seed'lerin onunde", async () => {
    const SEED = uid(47);
    const service = await loadService(tablolar([candidateRow(SEED, 1, { is_seed_profile: true, is_test_account: true })]), {
      dormantDays: 0,
    });
    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual([UYUYAN_YAKIN, AKTIF_UZAK, SEED]);
  });
});

describe("discover — kademeli mesafe", () => {
  it("radius disindaki aday artik elenmez, tier ile isaretlenir", async () => {
    const service = await loadService({
      users: [viewerRow(), candidateRow("uzak", 300)],
      swipes: [],
      matches: [],
      questions: questionsFor(["uzak"]),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards).toHaveLength(1);
    expect(res.cards[0].user_id).toBe("uzak");
    expect(res.cards[0].distance_tier).toBe(2);
  });

  it("yakin aday, ham skoru daha yuksek olan uzak adaydan once gelir", async () => {
    // "uzak" adayin profili kusursuz + cok begenilmis; skoru yakin adaydan yuksek.
    // Tier birincil anahtar oldugu icin yine de arkada kalmali.
    const service = await loadService({
      users: [
        viewerRow(),
        candidateRow("yakin", 10, { profile_completion: 40, photos: ["p1.jpg"], bio: null }),
        candidateRow("uzak", 300, {
          profile_completion: 100,
          photos: ["a.jpg", "b.jpg", "c.jpg"],
          like_received_count: 90,
          times_shown_count: 100,
          green_diamonds: 500,
        }),
      ],
      swipes: [],
      matches: [],
      questions: questionsFor(["yakin", "uzak"]),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual(["yakin", "uzak"]);
  });

  it("ayni tier icinde yakin olan once gelir", async () => {
    const service = await loadService({
      users: [viewerRow(), candidateRow("orta", 900), candidateRow("daha-yakin", 200)],
      swipes: [],
      matches: [],
      questions: questionsFor(["orta", "daha-yakin"]),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.distance_tier)).toEqual([2, 2]);
    expect(res.cards.map((c) => c.user_id)).toEqual(["daha-yakin", "orta"]);
  });

  it("boost tier'i asamaz — boostlu uzak aday, boostsuz yakin adayin onune gecmez", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const service = await loadService({
      users: [
        viewerRow(),
        candidateRow("yakin", 10),
        candidateRow("uzak-boostlu", 3000, { boost_until: future }),
      ],
      swipes: [],
      matches: [],
      questions: questionsFor(["yakin", "uzak-boostlu"]),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual(["yakin", "uzak-boostlu"]);
    expect(res.cards[1].is_boosted).toBe(true);
  });

  it("dil filtresi mesafe sinirsiz olsa da gevsemez", async () => {
    // Adayin sorulari sadece Almanca; izleyicinin dili tr. Mesafe artik
    // elemiyor ama dil kapisi elemeli — yoksa cozulemeyen kart uretiriz
    // (quiz.service.startSession dil filtresi sonrasi 2'nin altinda NO_QUESTIONS atar).
    const service = await loadService({
      users: [viewerRow(), candidateRow("almanca", 3000)],
      swipes: [],
      matches: [],
      questions: questionsFor(["almanca"], "de"),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards).toHaveLength(0);
  });

  it("soru sayisi 2'nin altindaki aday hala elenir", async () => {
    const service = await loadService({
      users: [viewerRow(), candidateRow("tek-soru", 10)],
      swipes: [],
      matches: [],
      questions: [
        { user_id: "tek-soru", category: "life", stats_correct: 0, stats_wrong: 0, locale: "tr" },
      ],
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards).toHaveLength(0);
  });

  // Backoffice ban'i yalniz API girisini kesiyordu; banli profil baskalarinin
  // havuzunda kart olarak donmeye devam ediyordu.
  it("banli aday discover havuzunda gorunmez", async () => {
    const service = await loadService({
      users: [viewerRow(), candidateRow("banli", 10, { is_banned: true }), candidateRow("temiz", 12)],
      swipes: [],
      matches: [],
      questions: questionsFor(["banli", "temiz"]),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual(["temiz"]);
  });

  it("fotografsiz aday hala elenir", async () => {
    const service = await loadService({
      users: [viewerRow(), candidateRow("fotosuz", 10, { photos: [] })],
      swipes: [],
      matches: [],
      questions: questionsFor(["fotosuz"]),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards).toHaveLength(0);
  });
});

describe("undoSwipe — tier tutarliligi", () => {
  // undoSwipe targetId'yi assertUuid'den geciriyor, bu yuzden gercek UUID sart.
  const UZAK_ID = "00000000-0000-4000-8000-0000000000ff";

  it("undo edilen kart, discover ile ayni distance_tier'i tasir", async () => {
    const service = await loadService({
      users: [viewerRow(), candidateRow(UZAK_ID, 300)],
      swipes: [{ swiper_id: VIEWER_ID, target_id: UZAK_ID, action: "REJECT" }],
      matches: [],
      questions: questionsFor([UZAK_ID]),
    });

    const card = await service.undoSwipe(VIEWER_ID, UZAK_ID);
    // Ayni mesafe discover'da tier 2 donuyor (bkz. yukaridaki test).
    expect(card.distance_tier).toBe(2);
  });
});

describe("discover — dil tercihi bossa uygulama dili son care", () => {
  // 054 sonrasi DB varsayilani '{}'; sutun VE tablo bos kalirsa filtre tamamen
  // devre disi kaliyordu (kullanici okuyamadigi dilde profiller goruyordu).
  it("sutun ve tablo bosken izleyicinin uygulama diliyle filtreler, filtresiz dusmez", async () => {
    const service = await loadService({
      users: [
        viewerRow({ preferred_languages: [], locale: "de" }),
        candidateRow("turkce", 10),
        candidateRow("almanca", 20),
      ],
      user_languages: [],
      swipes: [],
      matches: [],
      questions: [...questionsFor(["turkce"], "tr"), ...questionsFor(["almanca"], "de")],
    }, { userLanguages: [] });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id), `empty_reason=${res.empty_reason}`).toEqual(["almanca"]);
  });
});

describe("discover — empty_reason", () => {
  it("sadece dil filtresi eledigi zaman 'language' doner", async () => {
    const service = await loadService({
      users: [viewerRow(), candidateRow("almanca", 30)],
      swipes: [],
      matches: [],
      questions: questionsFor(["almanca"], "de"),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards).toHaveLength(0);
    expect(res.empty_reason).toBe("language");
  });

  it("hic aday yokken 'no_candidates' doner", async () => {
    const service = await loadService({
      users: [viewerRow()],
      swipes: [],
      matches: [],
      questions: [],
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards).toHaveLength(0);
    expect(res.empty_reason).toBe("no_candidates");
  });

  it("soru/foto kapisi eledigi zaman 'no_candidates' doner (dil degil)", async () => {
    const service = await loadService({
      users: [viewerRow(), candidateRow("fotosuz", 10, { photos: [] })],
      swipes: [],
      matches: [],
      questions: questionsFor(["fotosuz"]),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.empty_reason).toBe("no_candidates");
  });

  it("kart varken empty_reason hic gonderilmez", async () => {
    const service = await loadService({
      users: [viewerRow(), candidateRow("yakin", 10)],
      swipes: [],
      matches: [],
      questions: questionsFor(["yakin"]),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards).toHaveLength(1);
    expect(res.empty_reason).toBeUndefined();
  });
});

describe("discover — buyuk aday havuzu (canli olay 2026-09-17)", () => {
  const ADAY_SAYISI = 250;
  const adaylar = Array.from({ length: ADAY_SAYISI }, (_, i) => uid(100 + i));

  const tablolar = (): Tables => ({
    users: [viewerRow({ match_radius_km: 500 }), ...adaylar.map((id, i) => candidateRow(id, 1 + (i % 40)))],
    questions: questionsFor(adaylar),
    swipes: [],
    matches: [],
  });

  it("havuz 100 adayi asinca soru sayilari kaybolmaz — kart doner", async () => {
    // Canli olay: soru istatistigi TUM adaylari tek `.in()` ile cekiyordu. PostgREST
    // sorgusu URL'de gider; 486 uuid ~18 KB eder ve istek "fetch failed" ile patlar.
    // Sonuc: her adayin soru sayisi 0 sayiliyor, "2+ soru" kapisi tum havuzu eliyordu.
    const svc = await loadService(tablolar());
    const r = await svc.discover(VIEWER_ID, 1);

    expect(r.cards.length).toBeGreaterThan(0);
    expect(r.empty_reason).toBeUndefined();
  });

  it("soru istatistigi sorgusu patlarsa SESSIZCE bos donmez", async () => {
    // Asil hata sessiz yutmaydi: `const { data } = await ...` ile error hic okunmuyordu.
    // Bos liste "aday yok" gibi gorunur — yanlis sonuc, hatadan beterdir.
    const svc = await loadService(tablolar(), { failOn: [{ table: "questions", op: "select" }] });

    await expect(svc.discover(VIEWER_ID, 1)).rejects.toThrow();
  });
});

describe("discover — test hesabi gorunurlugu", () => {
  // Uretimdeki bayraklar: seed = is_seed_profile + is_test_account; diger test hesaplari
  // (tester_*, magaza inceleme) yalniz is_test_account.
  const tablolar = (izleyici: Record<string, unknown>) => ({
    users: [
      viewerRow(izleyici),
      candidateRow("gercek", 5),
      candidateRow("seed", 6, { is_seed_profile: true, is_test_account: true }),
      candidateRow("tester", 7, { is_seed_profile: false, is_test_account: true }),
    ],
    swipes: [],
    matches: [],
    questions: questionsFor(["gercek", "seed", "tester"]),
  });

  it("test admin OLMAYAN izleyici seed profili gorur", async () => {
    const service = await loadService(tablolar({ is_test_admin: false }));
    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual(["gercek", "seed"]);
  });

  it("test admin olmayan izleyici seed OLMAYAN test hesabini gormez", async () => {
    const service = await loadService(tablolar({ is_test_admin: false }));
    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).not.toContain("tester");
  });

  it("test admin hepsini gorur (seed en sonda)", async () => {
    const service = await loadService(tablolar({ is_test_admin: true }));
    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual(["gercek", "tester", "seed"]);
  });
});

describe("discover — seed profiller en sonda", () => {
  // Seed profiller (416 test hesabi) herkese gorunur (bkz. "test hesabi gorunurlugu").
  // Gercek kullanicilar tukenmeden seed gosterilmemeli: uzak bir gercek
  // aday bile yakin bir seed'in onundedir; tier/skor ancak seed olmayanlar
  // arasinda ve seed'ler arasinda ayri ayri siralar.
  it("yakin ve yuksek skorlu seed, uzak gercek adayin ARKASINDA kalir", async () => {
    const service = await loadService({
      users: [
        viewerRow(),
        candidateRow("seed-yakin", 5, {
          is_seed_profile: true,
          profile_completion: 100,
          photos: ["a.jpg", "b.jpg", "c.jpg"],
          like_received_count: 90,
          times_shown_count: 100,
        }),
        candidateRow("gercek-uzak", 300, { is_seed_profile: false, profile_completion: 40 }),
        candidateRow("gercek-yakin", 20, { is_seed_profile: false }),
      ],
      swipes: [],
      matches: [],
      questions: questionsFor(["seed-yakin", "gercek-uzak", "gercek-yakin"]),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual(["gercek-yakin", "gercek-uzak", "seed-yakin"]);
  });

  it("gercek aday hic kalmayinca seed'ler gelir — havuz bos gorunmez", async () => {
    const service = await loadService({
      users: [
        viewerRow(),
        candidateRow("seed-1", 5, { is_seed_profile: true }),
        candidateRow("seed-2", 50, { is_seed_profile: true }),
        candidateRow("swiped", 1, { is_seed_profile: false }),
      ],
      swipes: [{ swiper_id: VIEWER_ID, target_id: "swiped", created_at: new Date().toISOString() }],
      matches: [],
      questions: questionsFor(["seed-1", "seed-2", "swiped"]),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).toEqual(["seed-1", "seed-2"]);
    expect(res.empty_reason).toBeUndefined();
  });

  it("seed'ler sayfa siniri asilinca da sonraki sayfalarda, gerceklerden sonra gelir", async () => {
    // 12 gercek + 3 seed: sayfa 1 = 10 gercek, sayfa 2 = 2 gercek + 3 seed.
    const gercekler = Array.from({ length: 12 }, (_, i) => uid(200 + i));
    const seedler = Array.from({ length: 3 }, (_, i) => uid(300 + i));
    const service = await loadService({
      users: [
        viewerRow(),
        ...seedler.map((id) => candidateRow(id, 1, { is_seed_profile: true })),
        ...gercekler.map((id, i) => candidateRow(id, 100 + i, { is_seed_profile: false })),
      ],
      swipes: [],
      matches: [],
      questions: questionsFor([...gercekler, ...seedler]),
    });

    const sayfa1 = await service.discover(VIEWER_ID, 1);
    const sayfa2 = await service.discover(VIEWER_ID, 2);
    expect(sayfa1.cards.every((c) => gercekler.includes(c.user_id))).toBe(true);
    expect(sayfa2.cards.map((c) => c.user_id)).toEqual([gercekler[10], gercekler[11], ...seedler]);
  });

  it("aday tavani (500) dolunca seed'ler gercek kullanicilari sorgudan DISARI ITMEZ", async () => {
    // Seed'ler surekli "cevrimici" ritmi tutar (last_seen_at taze). Sorgu salt
    // last_seen_at ile siralansaydi 500 seed tavani doldurur, gercek kullanici
    // hic cekilmezdi. Birincil anahtar is_seed_profile oldugu icin gercek
    // kullanici, en eski last_seen_at ile bile listeye girer.
    // Iddia sorgu tavani hakkinda; uyuyan siralamasi (3 Eki: uyuyan gercek seed'lerin
    // arkasinda) ayri testte — burada kapatilir ki ilk kart sorguya girisi kanitlasin.
    const seedler = Array.from({ length: 500 }, (_, i) => uid(1000 + i));
    const eskiTarih = "2026-01-01T00:00:00Z";
    const service = await loadService({
      users: [
        viewerRow(),
        ...seedler.map((id) => candidateRow(id, 5, { is_seed_profile: true })),
        candidateRow("gercek-eski", 10, { is_seed_profile: false, last_seen_at: eskiTarih }),
      ],
      swipes: [],
      matches: [],
      questions: questionsFor([...seedler, "gercek-eski"]),
    }, { dormantDays: 0 });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards[0].user_id).toBe("gercek-eski");
  });
});

describe("discover — basarisiz quiz'in hedefi bir kez geri doner (2026-10-04)", () => {
  const FRESH = uid(70);
  const RETRY = uid(71);
  const SEED = uid(72);
  const DAY = 86_400_000;
  const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();
  const failedSession = (target: string, d: number, over: Record<string, unknown> = {}) => ({
    id: `s-${target}-${d}`, solver_id: VIEWER_ID, target_id: target, status: "FAILED",
    started_at: daysAgo(d), completed_at: daysAgo(d), expires_at: daysAgo(d), ...over,
  });
  const like = (target: string, d = 10) => ({ swiper_id: VIEWER_ID, target_id: target, action: "LIKE", created_at: daysAgo(d) });

  function tables(over: Partial<Tables> = {}): Tables {
    return {
      users: [viewerRow(), candidateRow(RETRY, 1), candidateRow(FRESH, 40)],
      swipes: [like(RETRY)],
      matches: [],
      quiz_sessions: [failedSession(RETRY, 8)],
      questions: questionsFor([RETRY, FRESH]),
      ...over,
    };
  }
  const ids = (r: { cards: { user_id: string }[] }) => r.cards.map((c) => c.user_id);

  it("bekleme dolunca geri doner — yakin olsa da gorulmemis profilin ARKASINDA", async () => {
    const svc = await loadService(tables());
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH, RETRY]);
  });

  it("tekrar edilen aktif gercek kisi yeni seed'in ONUNDE (grup sirasi bozulmaz)", async () => {
    const t = tables();
    t.users!.push(candidateRow(SEED, 1, { is_seed_profile: true, is_test_account: true }));
    t.questions = questionsFor([RETRY, FRESH, SEED]);
    const svc = await loadService(t);
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH, RETRY, SEED]);
  });

  it("bekleme dolmadiysa donmez", async () => {
    const svc = await loadService(tables({ quiz_sessions: [failedSession(RETRY, 3)] }));
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH]);
  });

  it("bekleme dolmadi ama hedef izleyicinin dilinde YENI soru ekledi → doner", async () => {
    const q = questionsFor([RETRY, FRESH]).map((r) => ({ ...r, created_at: daysAgo(60) }));
    q.push({ user_id: RETRY, category: "life", stats_correct: 0, stats_wrong: 0, locale: "tr", created_at: daysAgo(1) } as never);
    const svc = await loadService(tables({ quiz_sessions: [failedSession(RETRY, 3)], questions: q }));
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH, RETRY]);
  });

  it("yeni soru izleyicinin OKUYAMADIGI dildeyse bekleme atlanmaz", async () => {
    const q = questionsFor([RETRY, FRESH]).map((r) => ({ ...r, created_at: daysAgo(60) }));
    q.push({ user_id: RETRY, category: "life", stats_correct: 0, stats_wrong: 0, locale: "en", created_at: daysAgo(1) } as never);
    const svc = await loadService(tables({ quiz_sessions: [failedSession(RETRY, 3)], questions: q }));
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH]);
  });

  it("ikinci basarisizliktan sonra kalici gider (hedef basina tek tekrar)", async () => {
    const svc = await loadService(tables({ quiz_sessions: [failedSession(RETRY, 30), failedSession(RETRY, 10)] }));
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH]);
  });

  it("ozellik kapaliyken (0) donmez — eski davranis", async () => {
    const svc = await loadService(tables(), { retryDays: 0 });
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH]);
  });

  it("yarida birakilan (suresi gecmis IN_PROGRESS) quiz de basarisizlik sayilir", async () => {
    const svc = await loadService(tables({
      quiz_sessions: [failedSession(RETRY, 9, { status: "IN_PROGRESS", completed_at: null, expires_at: daysAgo(8) })],
    }));
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH, RETRY]);
  });

  it("pasif eslesme (eslesip ayrilmis) geri donmez", async () => {
    const svc = await loadService(tables({
      matches: [{ id: "m1", user1_id: VIEWER_ID, user2_id: RETRY, is_active: false }],
    }));
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH]);
  });

  it("REJECT edilmis hedef basarisiz gecmisi olsa da donmez", async () => {
    const svc = await loadService(tables({ swipes: [{ ...like(RETRY), action: "REJECT" }] }));
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH]);
  });

  it("yenilenmis LIKE (tekrar hakki kullanildi, quiz baslamadi) desteden cikar — ilk LIKE gibi", async () => {
    const svc = await loadService(tables({ swipes: [like(RETRY, 1)] }));
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH]);
  });

  it("hakki bitmis hedef swipe satiri silinmis olsa da (undo) dislanir", async () => {
    const svc = await loadService(tables({ swipes: [], quiz_sessions: [failedSession(RETRY, 30), failedSession(RETRY, 10)] }));
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH]);
  });

  it("gecmis sorgusu patlarsa Discover dusmez, eski davranisa doner (tekrar yok)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const svc = await loadService(tables(), { failOn: [{ table: "quiz_sessions", op: "select" }] });
    expect(ids(await svc.discover(VIEWER_ID))).toEqual([FRESH]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("[quiz-retry]"), expect.anything(), expect.anything());
  });

  it("quiz_sessions discover basina TEK kez okunur (maliyet)", async () => {
    const svc = await loadService(tables());
    await svc.discover(VIEWER_ID);
    expect(sonFake.queries.filter((q) => q.table === "quiz_sessions")).toHaveLength(1);
  });
});

describe("swipe — tekrar denemesinde LIKE yenilenir (UNIQUE swipe)", () => {
  const TARGET = uid(80);
  const DAY = 86_400_000;
  const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();
  const base = (over: Partial<Tables> = {}): Tables => ({
    users: [viewerRow(), candidateRow(TARGET, 1)],
    swipes: [{ id: "sw1", swiper_id: VIEWER_ID, target_id: TARGET, action: "LIKE", created_at: daysAgo(10) }],
    quiz_sessions: [{
      id: "s1", solver_id: VIEWER_ID, target_id: TARGET, status: "FAILED",
      started_at: daysAgo(8), completed_at: daysAgo(8), expires_at: daysAgo(8),
    }],
    ...over,
  });

  it("geri donen hedefe ikinci LIKE: satir yenilenir, gunluk hak BIR kez duser; tekrar cagri dusurmez", async () => {
    const consume = vi.fn(async () => undefined);
    const svc = await loadService(base(), { incrementDailySwipes: consume });

    expect(await svc.swipe(VIEWER_ID, TARGET, "LIKE")).toEqual({ matched: false });
    expect(await svc.swipe(VIEWER_ID, TARGET, "LIKE")).toEqual({ matched: false });

    expect(consume).toHaveBeenCalledTimes(1);
    expect(sonFake.table("swipes")).toHaveLength(1);
    expect(Date.parse(sonFake.table("swipes")[0].created_at)).toBeGreaterThan(Date.parse(daysAgo(1)));
  });

  it("gunluk hak doluysa yenileme geri alinir ve DAILY_LIMIT_EXCEEDED doner (sonra tekrar denenebilir)", async () => {
    const limit = Object.assign(new Error("limit"), { code: "DAILY_LIMIT_EXCEEDED" });
    const seed = base();
    const likedAt = seed.swipes![0].created_at;
    const svc = await loadService(seed, { incrementDailySwipes: async () => { throw limit; } });

    await expect(svc.swipe(VIEWER_ID, TARGET, "LIKE")).rejects.toBe(limit);
    expect(sonFake.table("swipes")[0].created_at).toBe(likedAt);
  });

  it("basarisiz gecmisi olmayan mevcut LIKE eskisi gibi idempotent: hak dusmez", async () => {
    const consume = vi.fn(async () => undefined);
    const svc = await loadService(base({ quiz_sessions: [] }), { incrementDailySwipes: consume });
    await svc.swipe(VIEWER_ID, TARGET, "LIKE");
    expect(consume).not.toHaveBeenCalled();
  });

  it("hakki bitmis hedefe LIKE: QUIZ_RETRY_LOCKED, hak dusmez", async () => {
    const consume = vi.fn(async () => undefined);
    const two = base().quiz_sessions!.concat([{
      id: "s0", solver_id: VIEWER_ID, target_id: TARGET, status: "FAILED",
      started_at: daysAgo(20), completed_at: daysAgo(20), expires_at: daysAgo(20),
    }]);
    const svc = await loadService(base({ quiz_sessions: two }), { incrementDailySwipes: consume });
    await expect(svc.swipe(VIEWER_ID, TARGET, "LIKE")).rejects.toMatchObject({ code: "QUIZ_RETRY_LOCKED", params: { reason: "exhausted" } });
    expect(consume).not.toHaveBeenCalled();
  });

  it("bekleme surerken LIKE: hak dusmez, satir yenilenmez; hedef yeni soru eklediyse yenilenir", async () => {
    const consume = vi.fn(async () => undefined);
    const cooldown = [{
      id: "s1", solver_id: VIEWER_ID, target_id: TARGET, status: "FAILED",
      started_at: daysAgo(3), completed_at: daysAgo(3), expires_at: daysAgo(3),
    }];
    const seed = base({ quiz_sessions: cooldown, questions: [{ user_id: TARGET, created_at: daysAgo(30) }] });
    const likedAt = seed.swipes![0].created_at;
    let svc = await loadService(seed, { incrementDailySwipes: consume });
    await expect(svc.swipe(VIEWER_ID, TARGET, "LIKE")).rejects.toMatchObject({ params: { reason: "cooldown" } });
    expect(consume).not.toHaveBeenCalled();
    expect(sonFake.table("swipes")[0].created_at).toBe(likedAt);

    svc = await loadService(base({ quiz_sessions: cooldown, questions: [{ user_id: TARGET, created_at: daysAgo(1) }] }), { incrementDailySwipes: consume });
    await svc.swipe(VIEWER_ID, TARGET, "LIKE");
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it("undo: kilitli hedef geri getirilmez, undo hakki dusmez (eskiden bedava tekrar yoluydu)", async () => {
    const undo = vi.fn(async () => undefined);
    const cooldown = [{
      id: "s1", solver_id: VIEWER_ID, target_id: TARGET, status: "FAILED",
      started_at: daysAgo(1), completed_at: daysAgo(1), expires_at: daysAgo(1),
    }];
    const svc = await loadService(base({ quiz_sessions: cooldown, questions: [] }), { incrementDailyUndos: undo });
    await expect(svc.undoSwipe(VIEWER_ID, TARGET)).rejects.toMatchObject({ code: "QUIZ_RETRY_LOCKED" });
    expect(undo).not.toHaveBeenCalled();
    expect(sonFake.table("swipes")).toHaveLength(1);
  });
});

describe("swipe — karşılıklı eşleşme guard'ı", () => {
  const GAY = uid(70), HETERO = uid(71);
  const tablolar = (): Tables => ({
    users: [
      viewerRow({ gender: "MAN", gender_pref: "MAN" }),
      candidateRow(GAY, 1, { gender: "MAN", gender_pref: "MAN" }),
      candidateRow(HETERO, 2, { gender: "MAN", gender_pref: "WOMAN" }),
    ],
    swipes: [], matches: [], questions: [],
  });

  it("anahtar açıkken uyumsuz hedefe LIKE: NOT_COMPATIBLE, swipe yazılmaz, günlük hak harcanmaz", async () => {
    const incrementDailySwipes = vi.fn(async () => undefined);
    const service = await loadService(tablolar(), { mutual: true, incrementDailySwipes });
    await expect(service.swipe(VIEWER_ID, HETERO, "LIKE")).rejects.toMatchObject({ code: "NOT_COMPATIBLE" });
    expect(sonFake.table("swipes")).toHaveLength(0);
    expect(incrementDailySwipes).not.toHaveBeenCalled();
  });

  it("uyumlu hedefe LIKE yazılır", async () => {
    const service = await loadService(tablolar(), { mutual: true });
    await service.swipe(VIEWER_ID, GAY, "LIKE");
    expect(sonFake.table("swipes")).toHaveLength(1);
  });

  it("REJECT kontrol edilmez (zararsız; eski desteden kalan kart reddedilebilir)", async () => {
    const service = await loadService(tablolar(), { mutual: true });
    await service.swipe(VIEWER_ID, HETERO, "REJECT");
    expect(sonFake.table("swipes")).toHaveLength(1);
  });
});
