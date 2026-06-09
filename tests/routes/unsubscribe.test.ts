import { describe, it, expect, vi, beforeEach } from "vitest";

function makeRes() {
  const renderArg: { path?: string } = {};
  const res: any = {
    statusCode: 0,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    render(p: string) {
      renderArg.path = p;
      return this;
    },
  };
  return { res, renderArg };
}

describe("unsubscribeHandler", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 404 + invalid view when token missing", async () => {
    vi.doMock("../../src/services/email-unsubscribe-token.service.js", () => ({
      emailUnsubscribeTokenService: {
        findUnused: vi.fn().mockResolvedValue(null),
        markUsed: vi.fn(),
      },
    }));
    const { unsubscribeHandler } = await import("../../src/routes/unsubscribe.routes.js");
    const { res, renderArg } = makeRes();

    await unsubscribeHandler({ query: {} } as any, res);

    expect(res.statusCode).toBe(404);
    expect(renderArg.path).toContain("invalid.ejs");
  });

  it("returns 404 + invalid view when token not found", async () => {
    vi.doMock("../../src/services/email-unsubscribe-token.service.js", () => ({
      emailUnsubscribeTokenService: {
        findUnused: vi.fn().mockResolvedValue(null),
        markUsed: vi.fn(),
      },
    }));
    const { unsubscribeHandler } = await import("../../src/routes/unsubscribe.routes.js");
    const { res, renderArg } = makeRes();

    await unsubscribeHandler({ query: { token: "bogus" } } as any, res);

    expect(res.statusCode).toBe(404);
    expect(renderArg.path).toContain("invalid.ejs");
  });

  it("returns already-done view when token already used", async () => {
    vi.doMock("../../src/services/email-unsubscribe-token.service.js", () => ({
      emailUnsubscribeTokenService: {
        findUnused: vi.fn().mockResolvedValue({
          token: "t1",
          user_id: "u1",
          email_type: "match_new",
          used_at: new Date().toISOString(),
        }),
        markUsed: vi.fn(),
      },
    }));
    const { unsubscribeHandler } = await import("../../src/routes/unsubscribe.routes.js");
    const { res, renderArg } = makeRes();

    await unsubscribeHandler({ query: { token: "t1" } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(renderArg.path).toContain("already-done.ejs");
  });

  it("returns success + updates DB when token valid", async () => {
    const markUsedMock = vi.fn().mockResolvedValue(undefined);
    const userUpdateMock = vi.fn().mockResolvedValue({ error: null });
    vi.doMock("../../src/services/email-unsubscribe-token.service.js", () => ({
      emailUnsubscribeTokenService: {
        findUnused: vi.fn().mockResolvedValue({
          token: "t2",
          user_id: "u1",
          email_type: "match_new",
          used_at: null,
        }),
        markUsed: markUsedMock,
      },
    }));
    vi.doMock("../../src/config/supabase.js", () => ({
      supabase: {
        from: () => ({
          update: (payload: any) => {
            expect(payload).toEqual({ email_notifications_enabled: false });
            return { eq: userUpdateMock };
          },
        }),
      },
    }));
    const { unsubscribeHandler } = await import("../../src/routes/unsubscribe.routes.js");
    const { res, renderArg } = makeRes();

    await unsubscribeHandler({ query: { token: "t2" } } as any, res);

    expect(res.statusCode).toBe(200);
    expect(renderArg.path).toContain("success.ejs");
    expect(markUsedMock).toHaveBeenCalledWith("t2");
    expect(userUpdateMock).toHaveBeenCalledWith("id", "u1");
  });
});
