import { describe, it, expect, vi, beforeEach } from "vitest";

type UserRow = { profile_completion: number; badge_rewards_claimed: string[] | null };

function mockSupabase(opts: {
  user?: UserRow | null;
  selectError?: unknown;
  updateError?: unknown;
  onUpdate?: (patch: Record<string, unknown>, userIdFilter: string) => void;
}) {
  vi.doMock("../../src/config/supabase.js", () => ({
    supabase: {
      from: (table: string) => {
        expect(table).toBe("users");
        return {
          select: (_cols: string) => {
            const q: any = {
              _filters: {} as Record<string, unknown>,
              eq(col: string, val: unknown) {
                q._filters[col] = val;
                return q;
              },
              maybeSingle: () =>
                Promise.resolve({
                  data: opts.user ?? null,
                  error: opts.selectError ?? null,
                }),
            };
            return q;
          },
          update: (patch: Record<string, unknown>) => {
            const q: any = {
              eq(col: string, val: unknown) {
                if (col === "id" && typeof val === "string") {
                  opts.onUpdate?.(patch, val);
                }
                return Promise.resolve({ error: opts.updateError ?? null });
              },
            };
            return q;
          },
        };
      },
    },
  }));
}

function mockDiamond(addPurple: (userId: string, amount: number, reason: string) => Promise<void>) {
  vi.doMock("../../src/services/diamond.service.js", () => ({
    diamondService: { addPurple },
  }));
}

describe("badgeService.claimReward", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("throws USER_NOT_FOUND when the row is missing", async () => {
    mockSupabase({ user: null });
    mockDiamond(async () => {});
    const { badgeService } = await import("../../src/services/badge.service.js");

    await expect(badgeService.claimReward("u1", "SILVER")).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("throws USER_NOT_FOUND when supabase returns an error", async () => {
    mockSupabase({ user: null, selectError: { message: "boom" } });
    mockDiamond(async () => {});
    const { badgeService } = await import("../../src/services/badge.service.js");

    await expect(badgeService.claimReward("u1", "GOLD")).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
    });
  });

  it("throws BADGE_THRESHOLD_NOT_MET when completion is below SILVER threshold (60)", async () => {
    mockSupabase({ user: { profile_completion: 59, badge_rewards_claimed: [] } });
    const spy = vi.fn(async () => {});
    mockDiamond(spy);
    const { badgeService } = await import("../../src/services/badge.service.js");

    await expect(badgeService.claimReward("u1", "SILVER")).rejects.toMatchObject({
      code: "BADGE_THRESHOLD_NOT_MET",
      statusCode: 400,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("throws BADGE_THRESHOLD_NOT_MET when completion is below GOLD threshold (85)", async () => {
    mockSupabase({ user: { profile_completion: 84, badge_rewards_claimed: ["SILVER"] } });
    const spy = vi.fn(async () => {});
    mockDiamond(spy);
    const { badgeService } = await import("../../src/services/badge.service.js");

    await expect(badgeService.claimReward("u1", "GOLD")).rejects.toMatchObject({
      code: "BADGE_THRESHOLD_NOT_MET",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("throws BADGE_ALREADY_CLAIMED and does not credit diamonds twice (idempotency)", async () => {
    mockSupabase({ user: { profile_completion: 90, badge_rewards_claimed: ["SILVER"] } });
    const spy = vi.fn(async () => {});
    mockDiamond(spy);
    const { badgeService } = await import("../../src/services/badge.service.js");

    await expect(badgeService.claimReward("u1", "SILVER")).rejects.toMatchObject({
      code: "BADGE_ALREADY_CLAIMED",
      statusCode: 400,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("credits 3 purple diamonds and marks SILVER claimed on happy path", async () => {
    let updatePatch: Record<string, unknown> | null = null;
    let updateUserId: string | null = null;
    mockSupabase({
      user: { profile_completion: 60, badge_rewards_claimed: null },
      onUpdate: (patch, id) => {
        updatePatch = patch;
        updateUserId = id;
      },
    });
    const addPurple = vi.fn(async () => {});
    mockDiamond(addPurple);
    const { badgeService } = await import("../../src/services/badge.service.js");

    const result = await badgeService.claimReward("user-42", "SILVER");

    expect(addPurple).toHaveBeenCalledWith("user-42", 3, "BADGE_SILVER");
    expect(updateUserId).toBe("user-42");
    expect(updatePatch).toEqual({ badge_rewards_claimed: ["SILVER"] });
    expect(result).toEqual({
      level: "SILVER",
      diamonds_awarded: 3,
      badge_rewards_claimed: ["SILVER"],
    });
  });

  it("credits 10 purple diamonds and appends GOLD to existing claims", async () => {
    let updatePatch: Record<string, unknown> | null = null;
    mockSupabase({
      user: { profile_completion: 85, badge_rewards_claimed: ["SILVER"] },
      onUpdate: (patch) => {
        updatePatch = patch;
      },
    });
    const addPurple = vi.fn(async () => {});
    mockDiamond(addPurple);
    const { badgeService } = await import("../../src/services/badge.service.js");

    const result = await badgeService.claimReward("user-42", "GOLD");

    expect(addPurple).toHaveBeenCalledWith("user-42", 10, "BADGE_GOLD");
    expect(updatePatch).toEqual({ badge_rewards_claimed: ["SILVER", "GOLD"] });
    expect(result.badge_rewards_claimed).toEqual(["SILVER", "GOLD"]);
    expect(result.diamonds_awarded).toBe(10);
  });

  it("throws SERVER_ERROR when the update fails after diamonds are credited", async () => {
    mockSupabase({
      user: { profile_completion: 90, badge_rewards_claimed: [] },
      updateError: { message: "update failed" },
    });
    const addPurple = vi.fn(async () => {});
    mockDiamond(addPurple);
    const { badgeService } = await import("../../src/services/badge.service.js");

    await expect(badgeService.claimReward("user-42", "SILVER")).rejects.toMatchObject({
      code: "SERVER_ERROR",
      statusCode: 500,
    });
    // Karakterizasyon: diamond kredisi update hatasından ÖNCE yapiliyor,
    // yani SERVER_ERROR fırlarsa kullanici zaten elmasi almis oluyor.
    expect(addPurple).toHaveBeenCalledWith("user-42", 3, "BADGE_SILVER");
  });
});
