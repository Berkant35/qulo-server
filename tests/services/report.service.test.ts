import { describe, it, expect, vi, beforeEach } from "vitest";

type InsertPayload = {
  reporter_id: string;
  reported_id: string;
  reason: string;
  category: string;
};

function mockSupabase(opts: { data?: unknown; error?: unknown; onInsert?: (p: InsertPayload) => void }) {
  vi.doMock("../../src/config/supabase.js", () => ({
    supabase: {
      from: (table: string) => {
        expect(table).toBe("reports");
        return {
          insert(payload: InsertPayload) {
            opts.onInsert?.(payload);
            return {
              select(cols: string) {
                expect(cols).toBe("id, reporter_id, reported_id, reason, category, created_at");
                return {
                  single: () =>
                    Promise.resolve({
                      data: opts.data ?? null,
                      error: opts.error ?? null,
                    }),
                };
              },
            };
          },
        };
      },
    },
  }));
}

describe("reportService.create", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("inserts a report with the given fields and returns the row", async () => {
    let captured: InsertPayload | null = null;
    const row = {
      id: "r-1",
      reporter_id: "u-a",
      reported_id: "u-b",
      reason: "harassment",
      category: "behavior",
      created_at: "2026-08-01T00:00:00Z",
    };
    mockSupabase({
      data: row,
      onInsert: (p) => {
        captured = p;
      },
    });

    const { reportService } = await import("../../src/services/report.service.js");
    const result = await reportService.create("u-a", "u-b", "harassment", "behavior");

    expect(captured).toEqual({
      reporter_id: "u-a",
      reported_id: "u-b",
      reason: "harassment",
      category: "behavior",
    });
    expect(result).toEqual(row);
  });

  it("throws SERVER_ERROR when the insert fails", async () => {
    mockSupabase({ error: { message: "boom", code: "PG500" } });
    const { reportService } = await import("../../src/services/report.service.js");

    await expect(reportService.create("u-a", "u-b", "spam", "fake_profile")).rejects.toMatchObject({
      code: "SERVER_ERROR",
      statusCode: 500,
    });
  });
});
