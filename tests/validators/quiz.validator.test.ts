import { describe, it, expect } from "vitest";
import { answerQuizSchema } from "../../src/validators/quiz.validator.js";

/**
 * `time_spent` yalniz istatistik. Eski `.max(120)` 300 sn'lik soruda (+ medya ek suresi) durust
 * yavas cevabi 400 ile reddediyordu (review fix 3): ust sinir kalkti, servis kirpar; tur/negatiflik
 * dogrulamasi korunur.
 */
describe("answerQuizSchema — time_spent", () => {
  it("120 sn ustu durust sure kabul edilir (300 sn soru)", () => {
    const parsed = answerQuizSchema.safeParse({ selected_answer: 2, time_spent: 250 });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.time_spent).toBe(250);
  });

  it("cok buyuk sure de reddedilmez (servis kirpar)", () => {
    expect(answerQuizSchema.safeParse({ selected_answer: 2, time_spent: 10_000_000 }).success).toBe(true);
  });

  it("negatif, kesirli ya da sayi olmayan sure reddedilir", () => {
    expect(answerQuizSchema.safeParse({ selected_answer: 2, time_spent: -1 }).success).toBe(false);
    expect(answerQuizSchema.safeParse({ selected_answer: 2, time_spent: 1.5 }).success).toBe(false);
    expect(answerQuizSchema.safeParse({ selected_answer: 2, time_spent: "250" }).success).toBe(false);
  });

  it("time_spent opsiyonel kalir", () => {
    expect(answerQuizSchema.safeParse({ selected_answer: 1 }).success).toBe(true);
  });
});
