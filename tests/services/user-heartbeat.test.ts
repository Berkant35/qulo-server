import { describe, it, expect, vi, beforeEach } from "vitest";

describe("userService.heartbeat", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("updates users.last_active_at for the given userId", async () => {
    const updateCapture: { payload: any; whereId?: string } = { payload: null };
    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: (table: string) => {
          expect(table).toBe("users");
          return {
            update: (payload: any) => {
              updateCapture.payload = payload;
              return {
                eq: async (col: string, val: string) => {
                  expect(col).toBe("id");
                  updateCapture.whereId = val;
                  return { error: null };
                },
              };
            },
          };
        },
      },
    }));

    const { userService } = await import("../../src/services/user.service.js");
    await userService.heartbeat("user-abc");

    expect(updateCapture.whereId).toBe("user-abc");
    expect(updateCapture.payload).toHaveProperty("last_active_at");
    const ts = new Date(updateCapture.payload.last_active_at).getTime();
    const now = Date.now();
    expect(Math.abs(now - ts)).toBeLessThan(2000);
  });

  it("does not throw when supabase returns an error (best-effort)", async () => {
    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: () => ({
          update: () => ({
            eq: async () => ({ error: { message: "db down" } }),
          }),
        }),
      },
    }));

    const { userService } = await import("../../src/services/user.service.js");
    await expect(userService.heartbeat("user-1")).resolves.toBeUndefined();
  });
});
