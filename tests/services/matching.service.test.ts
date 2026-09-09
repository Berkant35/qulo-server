import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFakeSupabase, type Tables } from "../helpers/fake-supabase.js";

const VIEWER_ID = "00000000-0000-4000-8000-000000000001";

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
    const ids = ["cand-a", "cand-b", "cand-c"];
    const service = await loadService({
      users: [viewerRow(), ...ids.map((id, i) => candidateRow(id, 5 + i))],
      swipes: [{ swiper_id: VIEWER_ID, target_id: "cand-b", action: "LIKE" }],
      matches: [],
      questions: questionsFor(ids),
    });

    const res = await service.discover(VIEWER_ID, 1);
    expect(res.cards.map((c) => c.user_id)).not.toContain("cand-b");
    expect(res.cards).toHaveLength(2);
  });
});
