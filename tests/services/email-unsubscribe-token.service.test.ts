import { describe, it, expect, vi, beforeEach } from "vitest";

describe("emailUnsubscribeTokenService", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("create() inserts token row + returns 64-char hex token", async () => {
    const inserted: any[] = [];
    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: () => ({
          insert: async (row: any) => {
            inserted.push(row);
            return { error: null };
          },
        }),
      },
    }));

    const { emailUnsubscribeTokenService } = await import("../../src/services/email-unsubscribe-token.service.js");
    const token = await emailUnsubscribeTokenService.create("user-1", "match_new");

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      token,
      user_id: "user-1",
      email_type: "match_new",
    });
  });

  it("findUnused() returns null when token not found", async () => {
    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({ data: null, error: { code: "PGRST116" } }),
            }),
          }),
        }),
      },
    }));

    const { emailUnsubscribeTokenService } = await import("../../src/services/email-unsubscribe-token.service.js");
    const result = await emailUnsubscribeTokenService.findUnused("bogus");
    expect(result).toBeNull();
  });

  it("findUnused() returns row when token exists", async () => {
    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { token: "t1", user_id: "u1", email_type: "match_new", used_at: null },
                error: null,
              }),
            }),
          }),
        }),
      },
    }));

    const { emailUnsubscribeTokenService } = await import("../../src/services/email-unsubscribe-token.service.js");
    const result = await emailUnsubscribeTokenService.findUnused("t1");
    expect(result).toMatchObject({ token: "t1", user_id: "u1", email_type: "match_new" });
    expect(result?.used_at).toBeNull();
  });

  it("markUsed() sets used_at and targets correct token", async () => {
    const updates: any[] = [];
    let whereToken: string | null = null;
    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: () => ({
          update: (payload: any) => {
            updates.push(payload);
            return {
              eq: async (col: string, val: string) => {
                expect(col).toBe("token");
                whereToken = val;
                return { error: null };
              },
            };
          },
        }),
      },
    }));

    const { emailUnsubscribeTokenService } = await import("../../src/services/email-unsubscribe-token.service.js");
    await emailUnsubscribeTokenService.markUsed("t1");

    expect(updates).toHaveLength(1);
    expect(updates[0]).toHaveProperty("used_at");
    expect(whereToken).toBe("t1");
  });
});
