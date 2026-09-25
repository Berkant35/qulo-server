import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeSupabase, type Tables } from "../helpers/fake-supabase.js";

const VIEWER_ID = "00000000-0000-4000-8000-000000000001";

/** Deterministik test UUID'si. */
function uid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** Istanbul merkezli izleyici; radius 50 km, herkesi gormek istiyor. */
function viewerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VIEWER_ID,
    gender_pref: "BOTH",
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
    gender: "FEMALE",
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

async function loadService(
  tables: Tables,
  opts: { userLanguages?: string[]; failOn?: Array<Record<string, unknown>> } = {},
) {
  vi.resetModules();
  const fake = createFakeSupabase(tables, {
    rpc: { increment_times_shown: { data: null }, increment_like_received: { data: null } },
    ...(opts.failOn ? { failOn: opts.failOn as never } : {}),
  });
  vi.doMock("../../src/config/supabase.js", () => ({ supabase: fake.client }));
  vi.doMock("../../src/services/block.service.js", () => ({
    blockService: { getBlockedIds: async () => [], getBlockerIds: async () => [] },
  }));
  vi.doMock("../../src/services/user-language.service.js", () => ({
    userLanguageService: { getUserLanguages: async () => opts.userLanguages ?? ["tr"] },
  }));
  vi.doMock("../../src/services/subscription.service.js", () => ({
    subscriptionService: {
      incrementDailyUndos: async () => undefined,
      incrementDailySwipes: async () => undefined,
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

  function tablesWithLastMessage(message: Record<string, unknown>): Tables {
    return {
      users: [viewerRow(), candidateRow(OTHER, 1, { is_online: false })],
      matches: [
        { id: MATCH, user1_id: VIEWER_ID, user2_id: OTHER, matched_at: "2026-09-14T08:00:00Z", is_active: true },
      ],
      messages: [
        {
          match_id: MATCH,
          sender_id: OTHER,
          content: "icerik",
          is_image: false,
          audio_url: null,
          read_at: null,
          deleted_at: null,
          created_at: "2026-09-14T09:00:00Z",
          ...message,
        },
      ],
    };
  }

  it("sesli mesaj istenen dilde", async () => {
    const service = await loadService(tablesWithLastMessage({ audio_url: "https://cdn.example/a.m4a", content: "Sesli mesaj" }));

    const [en] = await service.getMatches(VIEWER_ID, "en");
    const [de] = await service.getMatches(VIEWER_ID, "de");

    expect(en.last_message).toBe("🎤 Voice message");
    expect(de.last_message).toBe("🎤 Sprachnachricht");
  });

  it("foto istenen dilde", async () => {
    const service = await loadService(tablesWithLastMessage({ is_image: true, content: "https://cdn.example/p.jpg" }));

    const [ja] = await service.getMatches(VIEWER_ID, "ja");

    expect(ja.last_message).toBe("📷 写真");
  });

  it("header gondermeyen eski istemci (tr) eskisiyle ayni metni gorur", async () => {
    const service = await loadService(tablesWithLastMessage({ audio_url: "https://cdn.example/a.m4a" }));

    const [tr] = await service.getMatches(VIEWER_ID, "tr");

    expect(tr.last_message).toBe("🎤 Sesli mesaj");
  });

  it("metin mesaji cevrilmez, oldugu gibi doner", async () => {
    const service = await loadService(tablesWithLastMessage({ content: "selam nasilsin" }));

    const [en] = await service.getMatches(VIEWER_ID, "en");

    expect(en.last_message).toBe("selam nasilsin");
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

describe("discover — seed profiller en sonda", () => {
  // Seed profiller (416 test hesabi) herkese gorunur (is_test_admin varsayilani
  // true). Gercek kullanicilar tukenmeden seed gosterilmemeli: uzak bir gercek
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
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards[0].user_id).toBe("gercek-eski");
  });
});
