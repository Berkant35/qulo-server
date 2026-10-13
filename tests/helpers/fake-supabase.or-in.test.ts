import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "./fake-supabase.js";

describe("fake-supabase .or() icinde in listesi", () => {
  const fake = () => createFakeSupabase({
    users: [
      { id: "gercek", is_seed_profile: false, locale: "de" },
      { id: "seed-tr", is_seed_profile: true, locale: "tr" },
      { id: "seed-it", is_seed_profile: true, locale: "it" },
    ],
  });

  it("col.in.(a,b) alternatifi listedeki degerleri esler, diger alternatifle OR'lanir", async () => {
    const { data } = await fake().client.from("users").select("id").or("is_seed_profile.eq.false,locale.in.(it,en)");
    expect((data as any[]).map((r) => r.id)).toEqual(["gercek", "seed-it"]);
  });

  it("parantezsiz in degeri patlar — gercek PostgREST de parse edemez", () => {
    expect(() => fake().client.from("users").select("id").or("locale.in.it")).toThrow(/parantezli/);
  });
});
