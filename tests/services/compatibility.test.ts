import { describe, it, expect } from "vitest";
import {
  bucketOf, wantsOf, isMutuallyCompatible, candidatePrefFilter, type CompatibilityProfile,
} from "../../src/services/compatibility.js";

const p = (gender: string | null, gender_pref: string | null): CompatibilityProfile => ({ gender, gender_pref });

const HETERO_MAN = p("MAN", "WOMAN");
const HETERO_WOMAN = p("WOMAN", "MAN");
const GAY_MAN = p("MAN", "MAN");
const LESBIAN = p("WOMAN", "WOMAN");
const BI_MAN = p("MAN", "BOTH");
const BI_WOMAN = p("WOMAN", "BOTH");
const DECLINED_MAN = p("MAN", null);
const OTHER_ALL = p("OTHER", "BOTH");
const NO_GENDER = p(null, "BOTH");

describe("bucketOf", () => {
  it("MAN/WOMAN/OTHER kendi kovası, NULL ve tanınmayan değer null", () => {
    expect(bucketOf(p("MAN", null))).toBe("MAN");
    expect(bucketOf(p("WOMAN", null))).toBe("WOMAN");
    expect(bucketOf(p("OTHER", null))).toBe("OTHER");
    expect(bucketOf(p(null, null))).toBeNull();
    expect(bucketOf(p("FEMALE", null))).toBeNull();
  });
});

describe("wantsOf", () => {
  it("MAN → {MAN}, WOMAN → {WOMAN}, BOTH ve NULL → üç kova", () => {
    expect([...wantsOf(p("X", "MAN"))]).toEqual(["MAN"]);
    expect([...wantsOf(p("X", "WOMAN"))]).toEqual(["WOMAN"]);
    expect([...wantsOf(p("X", "BOTH"))].sort()).toEqual(["MAN", "OTHER", "WOMAN"]);
    expect([...wantsOf(p("X", null))].sort()).toEqual(["MAN", "OTHER", "WOMAN"]);
  });
});

describe("isMutuallyCompatible — senaryo tablosu", () => {
  const table: Array<[string, CompatibilityProfile, CompatibilityProfile, boolean]> = [
    ["hetero erkek × hetero kadın", HETERO_MAN, HETERO_WOMAN, true],
    ["hetero kadın × gey erkek", HETERO_WOMAN, GAY_MAN, false],
    ["gey erkek × gey erkek", GAY_MAN, p("MAN", "MAN"), true],
    ["gey erkek × hetero erkek", GAY_MAN, HETERO_MAN, false],
    ["lezbiyen × lezbiyen", LESBIAN, p("WOMAN", "WOMAN"), true],
    ["lezbiyen × hetero kadın", LESBIAN, HETERO_WOMAN, false],
    ["bi erkek × hetero kadın", BI_MAN, HETERO_WOMAN, true],
    ["bi erkek × gey erkek", BI_MAN, GAY_MAN, true],
    ["bi erkek × hetero erkek", BI_MAN, HETERO_MAN, false],
    ["rızasız erkek × hetero kadın", DECLINED_MAN, HETERO_WOMAN, true],
    ["rızasız erkek × gey erkek", DECLINED_MAN, GAY_MAN, true],
    ["rızasız erkek × hetero erkek", DECLINED_MAN, HETERO_MAN, false],
    ["OTHER(herkes) × bi kadın", OTHER_ALL, BI_WOMAN, true],
    ["OTHER(herkes) × hetero erkek", OTHER_ALL, HETERO_MAN, false],
    ["cinsiyetsiz × bi kadın", NO_GENDER, BI_WOMAN, false],
  ];
  for (const [name, a, b, expected] of table) {
    it(`${name} → ${expected}`, () => expect(isMutuallyCompatible(a, b)).toBe(expected));
  }

  it("simetrik: tüm cinsiyet × tercih kombinasyonlarında f(a,b) === f(b,a)", () => {
    const genders = ["MAN", "WOMAN", "OTHER", null];
    const prefs = ["MAN", "WOMAN", "BOTH", null];
    const all = genders.flatMap((g) => prefs.map((pr) => p(g, pr)));
    for (const a of all) for (const b of all) {
      expect(isMutuallyCompatible(a, b)).toBe(isMutuallyCompatible(b, a));
    }
  });
});

describe("candidatePrefFilter", () => {
  it("erkek izleyici: tercihi NULL, MAN ya da BOTH olan aday", () => {
    expect(candidatePrefFilter("MAN")).toBe("gender_pref.is.null,gender_pref.eq.MAN,gender_pref.eq.BOTH");
  });
  it("kadın izleyici: NULL, WOMAN ya da BOTH", () => {
    expect(candidatePrefFilter("WOMAN")).toBe("gender_pref.is.null,gender_pref.eq.WOMAN,gender_pref.eq.BOTH");
  });
  it("OTHER izleyici: eq.OTHER ÜRETİLMEZ (enum'da yok → 22P02 tüm desteği düşürürdü)", () => {
    expect(candidatePrefFilter("OTHER")).toBe("gender_pref.is.null,gender_pref.eq.BOTH");
  });
});
