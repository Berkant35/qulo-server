import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "./fake-supabase.js";

describe("fake-supabase ilike/like — backslash kaçışı (PostgreSQL LIKE escape)", () => {
  it("\\% literal % arar, joker olarak çalışmaz", async () => {
    const fake = createFakeSupabase({
      users: [
        { id: "a", email: "a%b@example.com" },
        { id: "b", email: "axxb@example.com" },
      ],
    });
    const { data } = await fake.client.from("users").select("id").ilike("email", "a\\%b@example.com");
    expect((data as any[]).map((r) => r.id)).toEqual(["a"]);
  });

  it("\\_ literal _ arar, tek karakter jokeri olarak çalışmaz", async () => {
    const fake = createFakeSupabase({
      users: [
        { id: "a", email: "ali_veli@example.com" },
        { id: "b", email: "alixveli@example.com" },
      ],
    });
    const { data } = await fake.client.from("users").select("id").ilike("email", "%ali\\_veli%");
    expect((data as any[]).map((r) => r.id)).toEqual(["a"]);
  });

  it("\\\\ literal ters eğik çizgi arar", async () => {
    const fake = createFakeSupabase({
      users: [
        { id: "a", name: "a\\b" },
        { id: "b", name: "ab" },
      ],
    });
    const { data } = await fake.client.from("users").select("id").ilike("name", "a\\\\b");
    expect((data as any[]).map((r) => r.id)).toEqual(["a"]);
  });

  it("kaçışsız % ve _ geriye dönük uyumlu şekilde joker kalır", async () => {
    const fake = createFakeSupabase({
      users: [
        { id: "a", email: "foo@bar.com" },
        { id: "b", email: "nope@baz.com" },
      ],
    });
    const wildcardPercent = await fake.client.from("users").select("id").ilike("email", "%bar%");
    expect((wildcardPercent.data as any[]).map((r) => r.id)).toEqual(["a"]);

    const wildcardUnderscore = await fake.client.from("users").select("id").ilike("email", "fo_@bar.com");
    expect((wildcardUnderscore.data as any[]).map((r) => r.id)).toEqual(["a"]);
  });
});
