import { describe, it, expect, vi, beforeEach } from "vitest";

describe("appConfigService.updateConfig", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("updates the config row by id (never a filterless update)", async () => {
    const capture: { payload: any; whereId?: string } = { payload: null };

    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: (table: string) => {
          expect(table).toBe("app_config");
          return {
            select: (cols: string) => {
              expect(cols).toBe("id");
              return {
                limit: () => ({
                  single: async () => ({ data: { id: "row-1" }, error: null }),
                }),
              };
            },
            update: (payload: any) => {
              capture.payload = payload;
              return {
                eq: (col: string, val: string) => {
                  expect(col).toBe("id");
                  capture.whereId = val;
                  return {
                    select: () => ({
                      single: async () => ({ data: { id: "row-1", ...payload }, error: null }),
                    }),
                  };
                },
              };
            },
          };
        },
      },
    }));

    const { appConfigService } = await import("../../src/services/app-config.service.js");
    const result = await appConfigService.updateConfig({ min_version_ios: "2.0.5" });

    expect(capture.whereId).toBe("row-1");
    expect(capture.payload.min_version_ios).toBe("2.0.5");
    expect(capture.payload).toHaveProperty("updated_at");
    expect(result).toMatchObject({ id: "row-1", min_version_ios: "2.0.5" });
  });

  it("throws a descriptive error when the update fails", async () => {
    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: () => ({
          select: () => ({
            limit: () => ({
              single: async () => ({ data: { id: "row-1" }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({ data: null, error: { message: "permission denied" } }),
              }),
            }),
          }),
        }),
      },
    }));

    const { appConfigService } = await import("../../src/services/app-config.service.js");
    await expect(appConfigService.updateConfig({ min_version_ios: "2.0.5" })).rejects.toMatchObject({
      message: "permission denied",
    });
  });

  it("throws when the row fetch fails", async () => {
    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: () => ({
          select: () => ({
            limit: () => ({
              single: async () => ({ data: null, error: { message: "no rows" } }),
            }),
          }),
        }),
      },
    }));

    const { appConfigService } = await import("../../src/services/app-config.service.js");
    await expect(appConfigService.updateConfig({ min_version_ios: "2.0.5" })).rejects.toMatchObject({
      message: "no rows",
    });
  });

  it("throws when no config row exists (data null, no error)", async () => {
    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: () => ({
          select: () => ({
            limit: () => ({
              single: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      },
    }));

    const { appConfigService } = await import("../../src/services/app-config.service.js");
    await expect(appConfigService.updateConfig({ min_version_ios: "2.0.5" })).rejects.toMatchObject({
      message: "app_config row not found",
    });
  });
});
