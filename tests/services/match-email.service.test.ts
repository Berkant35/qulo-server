import { describe, it, expect, vi, beforeEach } from "vitest";

interface MockOwner {
  id: string;
  email: string;
  locale: string | null;
  last_active_at: string | null;
  email_notifications_enabled: boolean;
  email_verified?: boolean;
}

function mockDeps(opts: { owner: MockOwner | null; sendThrow?: boolean; emailedRecently?: boolean }) {
  const sendMock = opts.sendThrow
    ? vi.fn().mockRejectedValue(new Error("gmail down"))
    : vi.fn().mockResolvedValue("messageId-xyz");
  const createTokenMock = vi.fn().mockResolvedValue("test-token-abc");
  const issuedSinceMock = vi.fn().mockResolvedValue(opts.emailedRecently ?? false);

  vi.doMock("../../src/config/supabase.js", () => ({
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: opts.owner,
              error: opts.owner ? null : { code: "PGRST116" },
            }),
          }),
        }),
      }),
    },
  }));
  vi.doMock("../../src/services/email-unsubscribe-token.service.js", () => ({
    emailUnsubscribeTokenService: { create: createTokenMock, sentWithinDailyWindow: issuedSinceMock },
  }));
  vi.doMock("../../src/utils/gmail.js", () => ({
    sendEmail: sendMock,
  }));

  return { sendMock, createTokenMock, issuedSinceMock };
}

const ACTIVE_OWNER = (extra: Partial<MockOwner> = {}): MockOwner => ({
  id: "u1",
  email: "test@example.com",
  locale: "en",
  last_active_at: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
  email_notifications_enabled: true,
  email_verified: true,
  ...extra,
});

const INACTIVE_OWNER = (extra: Partial<MockOwner> = {}): MockOwner => ({
  id: "u1",
  email: "test@example.com",
  locale: "en",
  last_active_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
  email_notifications_enabled: true,
  email_verified: true,
  ...extra,
});

describe("matchEmailService.sendMatchEmail", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("skips when owner opted out (email_notifications_enabled=false)", async () => {
    const { sendMock } = mockDeps({
      owner: INACTIVE_OWNER({ email_notifications_enabled: false }),
    });
    const { matchEmailService } = await import("../../src/services/match-email.service.js");
    await matchEmailService.sendMatchEmail("u1");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("gunluk tavan: son 20 saatte e-posta gittiyse (tek hedefe gunde 4 eslesme e-postasi) atlar, token da uretmez", async () => {
    const { sendMock, createTokenMock, issuedSinceMock } = mockDeps({ owner: INACTIVE_OWNER(), emailedRecently: true });
    const { matchEmailService } = await import("../../src/services/match-email.service.js");
    await matchEmailService.sendMatchEmail("u1");
    expect(sendMock).not.toHaveBeenCalled();
    expect(createTokenMock).not.toHaveBeenCalled();
    expect(issuedSinceMock).toHaveBeenCalledWith("u1");
  });

  it("dogrulanmamis adrese eslesme e-postasi gitmez (baskasinin adresiyle acilan hesap)", async () => {
    const { sendMock, createTokenMock } = mockDeps({ owner: INACTIVE_OWNER({ email_verified: false }) });
    const { matchEmailService } = await import("../../src/services/match-email.service.js");
    await matchEmailService.sendMatchEmail("u1");
    expect(sendMock).not.toHaveBeenCalled();
    expect(createTokenMock).not.toHaveBeenCalled();
  });

  it("skips when owner active within 24 hours", async () => {
    const { sendMock } = mockDeps({ owner: ACTIVE_OWNER() });
    const { matchEmailService } = await import("../../src/services/match-email.service.js");
    await matchEmailService.sendMatchEmail("u1");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends when owner inactive 24h+ with FR locale", async () => {
    const { sendMock, createTokenMock } = mockDeps({
      owner: INACTIVE_OWNER({ locale: "fr" }),
    });
    const { matchEmailService } = await import("../../src/services/match-email.service.js");
    await matchEmailService.sendMatchEmail("u1");

    expect(createTokenMock).toHaveBeenCalledWith("u1", "match_new");
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0];
    expect(arg.to).toBe("test@example.com");
    expect(arg.subject).toMatch(/Quelqu'un a résolu/);
    expect(arg.html).toContain("test-token-abc");
  });

  it("treats NULL last_active_at as inactive (sends)", async () => {
    const { sendMock } = mockDeps({
      owner: INACTIVE_OWNER({ last_active_at: null }),
    });
    const { matchEmailService } = await import("../../src/services/match-email.service.js");
    await matchEmailService.sendMatchEmail("u1");
    expect(sendMock).toHaveBeenCalled();
  });

  it("falls back to en for unknown locale", async () => {
    const { sendMock } = mockDeps({
      owner: INACTIVE_OWNER({ locale: "zz" }),
    });
    const { matchEmailService } = await import("../../src/services/match-email.service.js");
    await matchEmailService.sendMatchEmail("u1");
    const arg = sendMock.mock.calls[0][0];
    expect(arg.subject).toMatch(/Someone solved/);
  });

  it("resolves (does not throw) when gmail send fails", async () => {
    const { sendMock } = mockDeps({
      owner: INACTIVE_OWNER(),
      sendThrow: true,
    });
    const { matchEmailService } = await import("../../src/services/match-email.service.js");
    await expect(matchEmailService.sendMatchEmail("u1")).resolves.toBeUndefined();
    expect(sendMock).toHaveBeenCalled();
  });

  it("skips silently when owner not found", async () => {
    const { sendMock } = mockDeps({ owner: null });
    const { matchEmailService } = await import("../../src/services/match-email.service.js");
    await matchEmailService.sendMatchEmail("ghost");
    expect(sendMock).not.toHaveBeenCalled();
  });
});
