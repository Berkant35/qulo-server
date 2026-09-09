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

async function loadService(tables: Tables) {
  vi.resetModules();
  const fake = createFakeSupabase(tables, {
    rpc: { increment_times_shown: { data: null }, increment_like_received: { data: null } },
  });
  vi.doMock("../../src/config/supabase.js", () => ({ supabase: fake.client }));
  vi.doMock("../../src/services/block.service.js", () => ({
    blockService: { getBlockedIds: async () => [], getBlockerIds: async () => [] },
  }));
  vi.doMock("../../src/services/user-language.service.js", () => ({
    userLanguageService: { getUserLanguages: async () => ["tr"] },
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
