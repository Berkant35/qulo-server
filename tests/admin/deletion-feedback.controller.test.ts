import { describe, it, expect, vi, beforeEach } from "vitest";

function fakeRes() {
  const res: any = {
    rendered: null as null | { view: string; locals: any },
    statusCode: 200,
    render(view: string, locals: any) {
      res.rendered = { view, locals };
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
  };
  return res;
}

function fakeReq(query: Record<string, string> = {}) {
  return { query, session: { adminEmail: "t@q.app" } } as any;
}

describe("deletionFeedbackAdminController.page", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders report + rows on success and computes churn type totals", async () => {
    vi.doMock("../../src/services/deletion-feedback.service.js", () => ({
      deletionFeedbackService: {
        getReport: vi.fn(async () => ({
          counts: [
            { reason_code: "few_matches", count: 3 },
            { reason_code: "found_someone", count: 2 },
            { reason_code: "skipped", count: 1 },
          ],
          total: 6,
        })),
        getRecent: vi.fn(async () => ({ rows: [{ id: "r1" }], total: 6 })),
      },
    }));

    const { deletionFeedbackAdminController } = await import(
      "../../src/admin/deletion-feedback.admin.controller.js"
    );
    const res = fakeRes();
    await deletionFeedbackAdminController.page(fakeReq({ days: "30" }), res);

    expect(res.rendered?.view).toBe("deletion-feedback");
    expect(res.rendered?.locals.tableMissing).toBe(false);
    expect(res.rendered?.locals.days).toBe(30);
    expect(res.rendered?.locals.byType).toEqual({ positive: 2, negative: 3, neutral: 1 });
  });

  it("renders setup banner when the table does not exist (PGRST205)", async () => {
    const { AppError } = await import("../../src/utils/errors.js");
    vi.doMock("../../src/services/deletion-feedback.service.js", () => ({
      deletionFeedbackService: {
        getReport: vi.fn(async () => {
          throw new AppError("PGRST205", 500, "Could not find the table");
        }),
        getRecent: vi.fn(async () => ({ rows: [], total: 0 })),
      },
    }));

    const { deletionFeedbackAdminController } = await import(
      "../../src/admin/deletion-feedback.admin.controller.js"
    );
    const res = fakeRes();
    await deletionFeedbackAdminController.page(fakeReq(), res);

    expect(res.rendered?.view).toBe("deletion-feedback");
    expect(res.rendered?.locals.tableMissing).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("renders 500 error page for unexpected failures (not masked as setup)", async () => {
    const { AppError } = await import("../../src/utils/errors.js");
    vi.doMock("../../src/services/deletion-feedback.service.js", () => ({
      deletionFeedbackService: {
        getReport: vi.fn(async () => {
          throw new AppError("42501", 500, "permission denied for table account_deletion_feedback");
        }),
        getRecent: vi.fn(async () => ({ rows: [], total: 0 })),
      },
    }));

    const { deletionFeedbackAdminController } = await import(
      "../../src/admin/deletion-feedback.admin.controller.js"
    );
    const res = fakeRes();
    await deletionFeedbackAdminController.page(fakeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(res.rendered?.view).toBe("error");
  });

  it("sanitizes days and page params", async () => {
    const getRecent = vi.fn(async () => ({ rows: [], total: 0 }));
    vi.doMock("../../src/services/deletion-feedback.service.js", () => ({
      deletionFeedbackService: {
        getReport: vi.fn(async () => ({ counts: [], total: 0 })),
        getRecent,
      },
    }));

    const { deletionFeedbackAdminController } = await import(
      "../../src/admin/deletion-feedback.admin.controller.js"
    );
    const res = fakeRes();
    await deletionFeedbackAdminController.page(fakeReq({ days: "999", page: "-5" }), res);

    // days=999 whitelist dışı → tüm zamanlar (undefined service'e, 0 view'a)
    expect(getRecent).toHaveBeenCalledWith(1, 20, undefined);
    expect(res.rendered?.locals.days).toBe(0);
  });
});
