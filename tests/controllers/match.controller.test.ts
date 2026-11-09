import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GET /discover ve POST /swipe/undo — sesli/gorselli soru rozet kapisi controller'da cozulur,
 * servis `{ active }` alir (quiz.controller ile ayni desen). Kapi hatasi Discover'i bozmaz.
 */
async function load(gate: () => Promise<boolean>) {
  const discover = vi.fn().mockResolvedValue({ cards: [] });
  const undoSwipe = vi.fn().mockResolvedValue({ user_id: "t1" });
  const mediaQuestionsActive = vi.fn(gate);
  vi.doMock("../../src/services/matching.service.js", () => ({ matchingService: { discover, undoSwipe } }));
  vi.doMock("../../src/services/media-questions-gate.js", () => ({ mediaQuestionsActive }));
  const mod = await import("../../src/controllers/match.controller.js");
  return { ...mod, discover, undoSwipe, mediaQuestionsActive };
}

const headers = { "x-app-version": "2.0.19" };

describe("match.controller — medya rozet kapisi", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  for (const active of [true, false]) {
    it(`discover: kapi ${active} → servis active:${active} alir`, async () => {
      const m = await load(async () => active);
      const res: any = { json: vi.fn() };
      const next = vi.fn();
      await m.discoverHandler({ headers, query: { page: 2 }, user: { userId: "u1" } } as any, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(m.mediaQuestionsActive).toHaveBeenCalledWith(headers);
      expect(m.discover).toHaveBeenCalledWith("u1", 2, { active });
      expect(res.json).toHaveBeenCalledWith({ cards: [] });
    });

    it(`undo: kapi ${active} → servis active:${active} alir`, async () => {
      const m = await load(async () => active);
      const res: any = { json: vi.fn() };
      const next = vi.fn();
      await m.undoSwipeHandler({ headers, params: { target_id: "t1" }, user: { userId: "u1" } } as any, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(m.undoSwipe).toHaveBeenCalledWith("u1", "t1", { active });
      expect(res.json).toHaveBeenCalledWith({ user_id: "t1" });
    });
  }

  it("kapi hatasi Discover'i ve undo'yu bozmaz: rozet kapali sayilir (fail-closed)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await load(async () => { throw new Error("boom"); });
    const res: any = { json: vi.fn() };
    const next = vi.fn();
    await m.discoverHandler({ headers: {}, query: { page: 1 }, user: { userId: "u1" } } as any, res, next);
    await m.undoSwipeHandler({ headers: {}, params: { target_id: "t1" }, user: { userId: "u1" } } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(m.discover).toHaveBeenCalledWith("u1", 1, { active: false });
    expect(m.undoSwipe).toHaveBeenCalledWith("u1", "t1", { active: false });
  });
});
