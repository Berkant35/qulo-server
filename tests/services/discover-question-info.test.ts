import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/config/supabase.js", () => ({ supabase: {} }));
const { buildQuestionInfo } = await import("../../src/services/discover-question-info.js");

const q = (o: Record<string, unknown> = {}) => ({ category: "life", stats_correct: 0, stats_wrong: 0, locale: "tr", ...o });

describe("buildQuestionInfo — kart soru ozeti", () => {
  it("kapi kapali (badgeLangs=null): yalniz eski dort anahtar, eski sirada", () => {
    const info = buildQuestionInfo([q({ voice_path: "a/voice.m4a" }), q({ locale: null })], null);
    expect(Object.keys(info)).toEqual(["count", "categories", "avg_difficulty", "languages"]);
    expect(info).toEqual({ count: 2, categories: ["life"], avg_difficulty: "unranked", languages: ["tr"] });
  });

  it("zorluk esikleri degismedi (>=10 deneme; >70 easy, >40 medium, >20 hard, aksi legendary)", () => {
    const at = (correct: number, wrong: number) => buildQuestionInfo([q({ stats_correct: correct, stats_wrong: wrong })], null).avg_difficulty;
    expect(at(5, 4)).toBe("unranked");
    expect(at(8, 2)).toBe("easy");
    expect(at(7, 3)).toBe("medium");
    expect(at(4, 6)).toBe("hard");
    expect(at(2, 8)).toBe("legendary");
  });

  it("kapi acik: rozet yalniz izleyici dilindeki sorudan; locale null → tr sayilir (questionLocale)", () => {
    expect(buildQuestionInfo([q({ locale: null, voice_path: "a/voice.m4a" })], ["tr"])).toMatchObject({ has_voice: true, has_image: false });
    expect(buildQuestionInfo([q({ locale: "en", voice_path: "a/voice.m4a" })], ["tr"])).toMatchObject({ has_voice: false });
    expect(buildQuestionInfo([], ["tr"])).toEqual({ count: 0, categories: [], avg_difficulty: "unranked", languages: [], has_voice: false, has_image: false });
  });
});
