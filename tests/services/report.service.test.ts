import { describe, it, expect, vi, beforeEach } from "vitest";

type InsertPayload = {
  reporter_id: string;
  reported_id: string;
  reason: string;
  category: string;
};

/**
 * `reason` artik opsiyonel (2026-09-09) ama `reports.reason` kolonu NOT NULL
 * ve default'suz, o yuzden servis sebep yoksa KATEGORIYI yaziyor. Migration
 * yerine bu secildi: kategori zaten zorunlu ve sikayetin ozunu tasiyor.
 */

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

  it("kendini sikayet reddedilir — moderasyon kuyrugu kirlenmesin", async () => {
    // DB'de bunu engelleyen kisit yok (yalnizca pkey + iki FK).
    let inserted = false;
    mockSupabase({ data: { id: "r-x" }, onInsert: () => { inserted = true; } });

    const { reportService } = await import("../../src/services/report.service.js");

    await expect(reportService.create("u-a", "u-a", "kendim", "OTHER")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(inserted).toBe(false);
  });

  it("sebep verilmezse KATEGORIYI yazar — kolon NOT NULL, bos birakilamaz", async () => {
    // Istemci sebep yazilmadiginda alani hic gondermiyor
    // (chat_moderation_mixin.dart:130). Eskiden sema bunu 400 ile reddediyordu;
    // artik kabul ediliyor ve kolona kategori yaziliyor.
    let captured: InsertPayload | null = null;
    mockSupabase({
      data: { id: "r-2" },
      onInsert: (p) => {
        captured = p;
      },
    });

    const { reportService } = await import("../../src/services/report.service.js");
    await reportService.create("u-a", "u-b", undefined, "HARASSMENT");

    expect(captured).toEqual({
      reporter_id: "u-a",
      reported_id: "u-b",
      reason: "HARASSMENT",
      category: "HARASSMENT",
    });
  });

  it("sebep verilirse kategori DEGIL sebep yazilir", async () => {
    let captured: InsertPayload | null = null;
    mockSupabase({
      data: { id: "r-3" },
      onInsert: (p) => {
        captured = p;
      },
    });

    const { reportService } = await import("../../src/services/report.service.js");
    await reportService.create("u-a", "u-b", "Surekli reklam atiyor", "SPAM");

    expect(captured!.reason).toBe("Surekli reklam atiyor");
    expect(captured!.category).toBe("SPAM");
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
