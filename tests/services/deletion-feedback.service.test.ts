import { describe, it, expect, vi, beforeEach } from "vitest";

describe("deletionFeedbackService", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getReport counts every reason code and sorts descending", async () => {
    const countsByReason: Record<string, number> = { few_matches: 5, found_someone: 2 };
    const queries: any[] = [];

    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: (table: string) => {
          expect(table).toBe("account_deletion_feedback");
          return {
            select: (_cols: string, opts: any) => {
              expect(opts).toMatchObject({ count: "exact", head: true });
              const q: any = {
                eq: vi.fn((col: string, code: string) => {
                  expect(col).toBe("reason_code");
                  q._code = code;
                  return q;
                }),
                gte: vi.fn(() => q),
                then: (resolve: (v: any) => void) =>
                  resolve({ count: countsByReason[q._code] ?? 0, data: null, error: null }),
              };
              queries.push(q);
              return q;
            },
          };
        },
      },
    }));

    const { deletionFeedbackService } = await import("../../src/services/deletion-feedback.service.js");
    const report = await deletionFeedbackService.getReport();

    expect(report.total).toBe(7);
    expect(report.counts[0]).toEqual({ reason_code: "few_matches", count: 5 });
    expect(report.counts[1]).toEqual({ reason_code: "found_someone", count: 2 });
    // Taksonomideki 10 kodun tamamı sorgulanmış olmalı
    expect(queries.length).toBe(10);
    // days verilmediğinde tarih filtresi uygulanmamalı
    expect(queries.every((q) => q.gte.mock.calls.length === 0)).toBe(true);
  });

  it("getReport applies the created_at cutoff when days is given", async () => {
    const gteCalls: Array<[string, string]> = [];

    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: () => ({
          select: () => {
            const q: any = {
              eq: vi.fn(() => q),
              gte: vi.fn((col: string, iso: string) => {
                gteCalls.push([col, iso]);
                return q;
              }),
              then: (resolve: (v: any) => void) => resolve({ count: 0, data: null, error: null }),
            };
            return q;
          },
        }),
      },
    }));

    const { deletionFeedbackService } = await import("../../src/services/deletion-feedback.service.js");
    await deletionFeedbackService.getReport(7);

    expect(gteCalls.length).toBe(10);
    const [col, iso] = gteCalls[0]!;
    expect(col).toBe("created_at");
    const cutoffAge = Date.now() - new Date(iso).getTime();
    expect(Math.abs(cutoffAge - 7 * 24 * 60 * 60 * 1000)).toBeLessThan(5000);
  });

  it("getRecent paginates with range and returns rows + total", async () => {
    const rangeCalls: Array<[number, number]> = [];
    const rows = [{ id: "f1", reason_code: "few_matches", created_at: "2026-07-01T00:00:00Z" }];

    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: () => ({
          select: (_cols: string, opts: any) => {
            expect(opts).toMatchObject({ count: "exact" });
            const q: any = {
              gte: vi.fn(() => q),
              order: vi.fn((col: string, o: any) => {
                expect(col).toBe("created_at");
                expect(o).toMatchObject({ ascending: false });
                return q;
              }),
              range: vi.fn((from: number, to: number) => {
                rangeCalls.push([from, to]);
                return q;
              }),
              then: (resolve: (v: any) => void) => resolve({ data: rows, count: 41, error: null }),
            };
            return q;
          },
        }),
      },
    }));

    const { deletionFeedbackService } = await import("../../src/services/deletion-feedback.service.js");
    const result = await deletionFeedbackService.getRecent(3, 20);

    expect(rangeCalls[0]).toEqual([40, 59]);
    expect(result.total).toBe(41);
    expect(result.rows).toEqual(rows);
  });

  it("getRecent throws an AppError preserving the PostgREST error code", async () => {
    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: () => ({
          select: () => {
            const q: any = {
              gte: vi.fn(() => q),
              order: vi.fn(() => q),
              range: vi.fn(() => q),
              then: (resolve: (v: any) => void) =>
                resolve({
                  data: null,
                  count: null,
                  error: { code: "PGRST205", message: "Could not find the table 'public.account_deletion_feedback' in the schema cache" },
                }),
            };
            return q;
          },
        }),
      },
    }));

    const { deletionFeedbackService } = await import("../../src/services/deletion-feedback.service.js");
    await expect(deletionFeedbackService.getRecent(1, 20)).rejects.toMatchObject({
      code: "PGRST205",
      message: expect.stringContaining("account_deletion_feedback"),
    });
  });
});
