import { describe, it, expect } from "vitest";
import {
  createWebQuizSchema,
  attemptSchema,
  slugParamSchema,
  bankQuerySchema,
} from "../../src/validators/web-quiz.validator.js";
import { WEB_QUIZ_QUESTION_COUNT } from "../../src/constants/web-quiz.js";

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const items = () =>
  Array.from({ length: WEB_QUIZ_QUESTION_COUNT }, (_, i) => ({ bank_id: uuid(i), correct: i % 4 }));
const valid = () => ({ locale: "tr", nickname: "  Ada  ", age_confirmed: true, items: items() });

// Kontrol karakteri testinde görünmez karakter dosyaya gömülmez; kaçış dizisiyle üretilir.
const BELL = String.fromCharCode(7);

describe("createWebQuizSchema", () => {
  it("geçerli girdiyi kabul eder ve takma adı kırpar", () => {
    const r = createWebQuizSchema.safeParse(valid());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nickname).toBe("Ada");
  });

  it("18+ onayı olmadan reddeder", () => {
    expect(createWebQuizSchema.safeParse({ ...valid(), age_confirmed: false }).success).toBe(false);
    const { age_confirmed: _omit, ...rest } = valid();
    expect(createWebQuizSchema.safeParse(rest).success).toBe(false);
  });

  it("tam olarak 5 soru ister", () => {
    expect(createWebQuizSchema.safeParse({ ...valid(), items: items().slice(0, 4) }).success).toBe(false);
    expect(
      createWebQuizSchema.safeParse({ ...valid(), items: [...items(), { bank_id: uuid(7), correct: 0 }] }).success,
    ).toBe(false);
  });

  it("aynı soruyu iki kez reddeder", () => {
    const dup = items();
    dup[1].bank_id = dup[0].bank_id;
    expect(createWebQuizSchema.safeParse({ ...valid(), items: dup }).success).toBe(false);
  });

  it("şık indeksi 0-3 dışında reddeder, uuid olmayan id reddeder", () => {
    const bad = items();
    bad[0].correct = 4;
    expect(createWebQuizSchema.safeParse({ ...valid(), items: bad }).success).toBe(false);
    const badId = items();
    badId[0].bank_id = "not-a-uuid";
    expect(createWebQuizSchema.safeParse({ ...valid(), items: badId }).success).toBe(false);
  });

  it("takma ad: boş, 25+ karakter ve kontrol karakteri reddedilir", () => {
    expect(createWebQuizSchema.safeParse({ ...valid(), nickname: "   " }).success).toBe(false);
    expect(createWebQuizSchema.safeParse({ ...valid(), nickname: "a".repeat(25) }).success).toBe(false);
    expect(createWebQuizSchema.safeParse({ ...valid(), nickname: `Ada${BELL}` }).success).toBe(false);
    expect(createWebQuizSchema.safeParse({ ...valid(), nickname: "Ayşe Ünal" }).success).toBe(true);
  });

  it("desteklenmeyen dili reddeder", () => {
    expect(createWebQuizSchema.safeParse({ ...valid(), locale: "xx" }).success).toBe(false);
    expect(bankQuerySchema.safeParse({ locale: "hi" }).success).toBe(true);
    expect(bankQuerySchema.safeParse({ locale: "" }).success).toBe(false);
  });
});

describe("attemptSchema", () => {
  it("5 cevap, her biri 0-3", () => {
    expect(attemptSchema.safeParse({ answers: [0, 1, 2, 3, 0] }).success).toBe(true);
    expect(attemptSchema.safeParse({ answers: [0, 1, 2, 3] }).success).toBe(false);
    expect(attemptSchema.safeParse({ answers: [0, 1, 2, 3, 4] }).success).toBe(false);
    expect(attemptSchema.safeParse({ answers: [0, 1, 2, 3, "0"] }).success).toBe(false);
  });
});

describe("slugParamSchema", () => {
  it("8 karakter, kod alfabesi (I/O/0/1 yok), büyük/küçük harf serbest", () => {
    expect(slugParamSchema.safeParse({ slug: "ABCD2345" }).success).toBe(true);
    expect(slugParamSchema.safeParse({ slug: "abcd2345" }).success).toBe(true);
    expect(slugParamSchema.safeParse({ slug: "ABCD234" }).success).toBe(false);
    expect(slugParamSchema.safeParse({ slug: "ABCD-345" }).success).toBe(false);
    expect(slugParamSchema.safeParse({ slug: "ABCD2345;" }).success).toBe(false);
    // Alfabe dışı ama alfanümerik: üretilemez, kabul de edilmez
    expect(slugParamSchema.safeParse({ slug: "IO01ABCD" }).success).toBe(false);
  });
});

describe("rezerve takma adlar", () => {
  it("Qulo/admin/destek gibi kimlik taklidi adlarını reddeder", () => {
    for (const nickname of ["Qulo", "qulo app", "ADMIN", "Destek", "moderator"]) {
      expect(createWebQuizSchema.safeParse({ ...valid(), nickname }).success).toBe(false);
    }
    expect(createWebQuizSchema.safeParse({ ...valid(), nickname: "Qulocu Ayşe" }).success).toBe(true);
  });
});
