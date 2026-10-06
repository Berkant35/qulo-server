import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFakeSupabase, type FakeSupabaseOptions, type Tables } from "../helpers/fake-supabase.js";

/**
 * Gösterim kapısı (spec 2026-10-06 kehanet açığı). Bilinen bir UUID'ye LIKE / quiz/start
 * yalnız Discover'ın son 30 günde gösterdiği ya da önceden etkileşilmiş hedefe açık; değilse
 * var olmayan hedefle AYNI yanıt (404 USER_NOT_FOUND) — 403/200 farkından tercih okunamaz.
 */

const V = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const X = "33333333-3333-4333-8333-333333333333";
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();

async function setup(tables: Tables, opts: { enabled?: boolean; fake?: FakeSupabaseOptions } = {}) {
  const fake = createFakeSupabase(tables, opts.fake);
  vi.doMock("../../src/config/supabase.js", () => ({ supabase: fake.client }));
  vi.doMock("../../src/services/app-config.service.js", () => ({
    appConfigService: { getServedGateEnabled: async () => opts.enabled ?? true },
  }));
  const { servedGate, SERVED_WINDOW_DAYS } = await import("../../src/services/served-gate.service.js");
  return { fake, servedGate, SERVED_WINDOW_DAYS };
}

const bos = (): Tables => ({ discover_served: [], swipes: [], matches: [], quiz_sessions: [], blocks: [] });

beforeEach(() => vi.resetModules());
afterEach(() => vi.restoreAllMocks());

describe("servedGate.assertReachable — anahtar açık", () => {
  it("hiç gösterilmemiş, etkileşimsiz hedef: USER_NOT_FOUND 404", async () => {
    const { servedGate } = await setup(bos());
    await expect(servedGate.assertReachable(V, T)).rejects.toMatchObject({ code: "USER_NOT_FOUND", statusCode: 404 });
  });

  it("son 30 gün içinde gösterilmiş hedef: geçer", async () => {
    const { servedGate } = await setup({ ...bos(), discover_served: [{ viewer_id: V, target_id: T, served_at: daysAgo(29) }] });
    await expect(servedGate.assertReachable(V, T)).resolves.toBeUndefined();
  });

  it("30 günden eski gösterim sayılmaz: USER_NOT_FOUND", async () => {
    const { servedGate } = await setup({ ...bos(), discover_served: [{ viewer_id: V, target_id: T, served_at: daysAgo(31) }] });
    await expect(servedGate.assertReachable(V, T)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });

  it("başkasına gösterilmiş kart izleyiciye kapı açmaz (viewer'a özgü)", async () => {
    const { servedGate } = await setup({ ...bos(), discover_served: [{ viewer_id: X, target_id: T, served_at: daysAgo(1) }] });
    await expect(servedGate.assertReachable(V, T)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });

  it("izleyicinin hedefe önceki LIKE'ı varsa geçer (deploy öncesi beğeni)", async () => {
    const { servedGate } = await setup({ ...bos(), swipes: [{ id: "s", swiper_id: V, target_id: T, action: "LIKE" }] });
    await expect(servedGate.assertReachable(V, T)).resolves.toBeUndefined();
  });

  it("yalnız REJECT satırı kapı açmaz (REJECT kapısız — rastgele UUID'yi REJECT edip kapıyı dolanma yolu)", async () => {
    const { servedGate } = await setup({ ...bos(), swipes: [{ id: "s", swiper_id: V, target_id: T, action: "REJECT" }] });
    await expect(servedGate.assertReachable(V, T)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });

  it("hedefin izleyiciye LIKE'ı izleyiciye kapı açmaz (yön)", async () => {
    const { servedGate } = await setup({ ...bos(), swipes: [{ id: "s", swiper_id: T, target_id: V, action: "LIKE" }] });
    await expect(servedGate.assertReachable(V, T)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });

  it.each([
    ["izleyici user1", { user1_id: V, user2_id: T }],
    ["izleyici user2", { user1_id: T, user2_id: V }],
  ])("aralarında eşleşme varsa geçer (%s, pasif dahil)", async (_ad, cift) => {
    const { servedGate } = await setup({ ...bos(), matches: [{ id: "m", ...cift, is_active: false }] });
    await expect(servedGate.assertReachable(V, T)).resolves.toBeUndefined();
  });

  it("izleyicinin hedefle önceki quiz oturumu varsa geçer", async () => {
    const { servedGate } = await setup({ ...bos(), quiz_sessions: [{ id: "q", solver_id: V, target_id: T, status: "FAILED" }] });
    await expect(servedGate.assertReachable(V, T)).resolves.toBeUndefined();
  });

  it("hedefin izleyiciyi çözdüğü quiz kapı açmaz (yön)", async () => {
    const { servedGate } = await setup({ ...bos(), quiz_sessions: [{ id: "q", solver_id: T, target_id: V, status: "FAILED" }] });
    await expect(servedGate.assertReachable(V, T)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });

  it.each([
    ["izleyici engelledi", { blocker_id: V, blocked_id: T }],
    ["hedef engelledi", { blocker_id: T, blocked_id: V }],
  ])("engel (%s): gösterilmiş olsa da USER_NOT_FOUND", async (_ad, engel) => {
    const { servedGate } = await setup({
      ...bos(),
      blocks: [{ id: "b", ...engel }],
      discover_served: [{ viewer_id: V, target_id: T, served_at: daysAgo(1) }],
    });
    await expect(servedGate.assertReachable(V, T)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });

  it("maliyet: gösterilmiş hedefte yalnız engel + served okunur (2 istek)", async () => {
    const { fake, servedGate } = await setup({ ...bos(), discover_served: [{ viewer_id: V, target_id: T, served_at: daysAgo(1) }] });
    await servedGate.assertReachable(V, T);
    expect(fake.queries.map((q) => q.table).sort()).toEqual(["blocks", "discover_served"]);
  });

  it("served okuma hatası: SERVER_ERROR (sessizce açılmaz), log yalnız hata kodu", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { servedGate } = await setup(
      { ...bos(), discover_served: [{ viewer_id: V, target_id: T, served_at: daysAgo(1) }] },
      { fake: { failOn: [{ table: "discover_served", op: "select", error: { message: `viewer ${V}`, code: "XX000" } }] } },
    );
    await expect(servedGate.assertReachable(V, T)).rejects.toMatchObject({ code: "SERVER_ERROR" });
    expect(JSON.stringify(err.mock.calls)).toContain("XX000");
    expect(JSON.stringify(err.mock.calls)).not.toContain(V);
  });
});

describe("servedGate.assertReachable — anahtar kapalı", () => {
  it("gösterilmemiş hedef geçer, served/swipe/match/quiz hiç okunmaz", async () => {
    const { fake, servedGate } = await setup(bos(), { enabled: false });
    await expect(servedGate.assertReachable(V, T)).resolves.toBeUndefined();
    expect(fake.queries.map((q) => q.table)).toEqual(["blocks"]);
  });

  it("engel yine uygulanır: USER_NOT_FOUND", async () => {
    const { servedGate } = await setup({ ...bos(), blocks: [{ id: "b", blocker_id: T, blocked_id: V }] }, { enabled: false });
    await expect(servedGate.assertReachable(V, T)).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });
});

describe("servedGate.recordServed", () => {
  it("sayfadaki kartları tek upsert ile yazar; tekrar gösterim served_at'i yeniler", async () => {
    const { fake, servedGate } = await setup({ ...bos(), discover_served: [{ viewer_id: V, target_id: T, served_at: daysAgo(20) }] });
    await servedGate.recordServed(V, [T, X]);
    expect(fake.queries.filter((q) => q.table === "discover_served")).toEqual([{ table: "discover_served", op: "upsert" }]);
    const rows = fake.table("discover_served");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.viewer_id).toBe(V);
      expect(Date.parse(row.served_at)).toBeGreaterThan(Date.parse(daysAgo(1)));
    }
  });

  it("boş sayfa: istek atılmaz", async () => {
    const { fake, servedGate } = await setup(bos());
    await servedGate.recordServed(V, []);
    expect(fake.queries).toHaveLength(0);
  });

  it("yazım hatası fırlatmaz; log yalnız hata kodu (id yok)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { servedGate } = await setup(bos(), {
      fake: { failOn: [{ table: "discover_served", op: "insert", error: { message: `key (viewer_id)=(${V})`, code: "23503" } }] },
    });
    await expect(servedGate.recordServed(V, [T])).resolves.toBeUndefined();
    expect(JSON.stringify(err.mock.calls)).toContain("23503");
    expect(JSON.stringify(err.mock.calls)).not.toContain(V);
  });
});

describe("servedGate.purgeExpired", () => {
  it("30 günden eski satırları siler, yenileri bırakır, silinen sayıyı döner", async () => {
    const { fake, servedGate, SERVED_WINDOW_DAYS } = await setup({
      ...bos(),
      discover_served: [
        { viewer_id: V, target_id: T, served_at: daysAgo(31) },
        { viewer_id: X, target_id: T, served_at: daysAgo(45) },
        { viewer_id: V, target_id: X, served_at: daysAgo(29) },
      ],
    });
    expect(SERVED_WINDOW_DAYS).toBe(30);
    expect(await servedGate.purgeExpired()).toBe(2);
    expect(fake.table("discover_served")).toEqual([expect.objectContaining({ viewer_id: V, target_id: X })]);
  });

  it("silme hatası fırlatır (cron loglar)", async () => {
    const { servedGate } = await setup(bos(), { fake: { failOn: [{ table: "discover_served", op: "delete", error: { message: "x", code: "57014" } }] } });
    await expect(servedGate.purgeExpired()).rejects.toBeTruthy();
  });
});
