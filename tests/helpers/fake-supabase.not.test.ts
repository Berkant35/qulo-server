import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "./fake-supabase.js";

describe("fake-supabase .not()", () => {
  it("not(col, 'is', null) null olan satirlari eler", async () => {
    const fake = createFakeSupabase({
      users: [
        { id: "a", lat: 41 },
        { id: "b", lat: null },
      ],
    });
    const { data } = await fake.client.from("users").select("id, lat").not("lat", "is", null);
    expect((data as any[]).map((r) => r.id)).toEqual(["a"]);
  });

  it("not(col, 'in', [...]) listedeki satirlari eler", async () => {
    const fake = createFakeSupabase({
      users: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
    const { data } = await fake.client.from("users").select("id").not("id", "in", ["b", "c"]);
    expect((data as any[]).map((r) => r.id)).toEqual(["a"]);
  });

  it("bos dislama listesi hicbir satiri elemez", async () => {
    const fake = createFakeSupabase({ users: [{ id: "a" }, { id: "b" }] });
    const { data } = await fake.client.from("users").select("id").not("id", "in", []);
    expect((data as any[]).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
