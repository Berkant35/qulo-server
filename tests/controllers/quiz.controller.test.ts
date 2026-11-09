import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GET /quiz/:session_id — medya kapisi controller'da cozulur, servis `{ active }` alir
 * (servis baslik okumaz → test edilebilir). Kapi: surum >= 2.0.19 VE `media_questions_enabled`.
 */
async function callWith(active: boolean) {
  const getCurrentQuestion = vi.fn().mockResolvedValue({ ok: true });
  const mediaQuestionsActive = vi.fn().mockResolvedValue(active);
  vi.doMock("../../src/services/quiz.service.js", () => ({ quizService: { getCurrentQuestion } }));
  vi.doMock("../../src/services/media-questions-gate.js", () => ({ mediaQuestionsActive }));
  const { getCurrentQuestionHandler } = await import("../../src/controllers/quiz.controller.js");
  const headers = { "x-app-version": "2.0.19" };
  const res: any = { json: vi.fn() };
  const next = vi.fn();

  await getCurrentQuestionHandler({ headers, params: { session_id: "s1" }, user: { userId: "u1" } } as any, res, next);

  expect(next).not.toHaveBeenCalled();
  expect(mediaQuestionsActive).toHaveBeenCalledWith(headers);
  expect(res.json).toHaveBeenCalledWith({ ok: true });
  return getCurrentQuestion.mock.calls[0];
}

describe("getCurrentQuestionHandler — medya kapisi", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("kapi acik → servis active:true alir", async () => {
    expect(await callWith(true)).toEqual(["s1", "u1", { active: true }]);
  });

  it("kapi kapali (eski istemci) → servis active:false alir", async () => {
    expect(await callWith(false)).toEqual(["s1", "u1", { active: false }]);
  });

  it("kapi hatasi quiz'i bozmaz: medya kapali sayilir (fail-closed), soru yine doner", async () => {
    const getCurrentQuestion = vi.fn().mockResolvedValue({ ok: true });
    vi.doMock("../../src/services/quiz.service.js", () => ({ quizService: { getCurrentQuestion } }));
    vi.doMock("../../src/services/media-questions-gate.js", () => ({
      mediaQuestionsActive: vi.fn().mockRejectedValue(new Error("boom")),
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { getCurrentQuestionHandler } = await import("../../src/controllers/quiz.controller.js");
    const res: any = { json: vi.fn() };
    const next = vi.fn();

    await getCurrentQuestionHandler({ headers: {}, params: { session_id: "s1" }, user: { userId: "u1" } } as any, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getCurrentQuestion).toHaveBeenCalledWith("s1", "u1", { active: false });
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});
