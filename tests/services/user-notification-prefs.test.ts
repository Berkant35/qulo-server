import { describe, it, expect, vi, beforeEach } from "vitest";

function setupMock(opts: {
  currentPrefs?: any;
  selectError?: any;
  updateError?: any;
}) {
  const updateCapture: { payload: any } = { payload: null };
  vi.doMock("../../src/config/supabase.js", () => ({
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: opts.selectError ? null : { notification_preferences: opts.currentPrefs ?? {} },
              error: opts.selectError ?? null,
            }),
          }),
        }),
        update: (payload: any) => {
          updateCapture.payload = payload;
          return {
            eq: async () => ({ error: opts.updateError ?? null }),
          };
        },
      }),
    },
  }));
  return updateCapture;
}

describe("userService.updateNotificationPreferences", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("mirrors email_matches=false to email_notifications_enabled column", async () => {
    const cap = setupMock({ currentPrefs: { messages: true } });
    const { userService } = await import("../../src/services/user.service.js");

    await userService.updateNotificationPreferences("u1", { email_matches: false });

    expect(cap.payload.email_notifications_enabled).toBe(false);
    expect(cap.payload.notification_preferences.email_matches).toBe(false);
    // existing JSONB content preserved
    expect(cap.payload.notification_preferences.messages).toBe(true);
  });

  it("mirrors email_matches=true to email_notifications_enabled column", async () => {
    const cap = setupMock({ currentPrefs: { email_matches: false } });
    const { userService } = await import("../../src/services/user.service.js");

    await userService.updateNotificationPreferences("u1", { email_matches: true });

    expect(cap.payload.email_notifications_enabled).toBe(true);
    expect(cap.payload.notification_preferences.email_matches).toBe(true);
  });

  it("does NOT touch email_notifications_enabled when email_matches is omitted", async () => {
    const cap = setupMock({ currentPrefs: {} });
    const { userService } = await import("../../src/services/user.service.js");

    await userService.updateNotificationPreferences("u1", { matches: true });

    expect("email_notifications_enabled" in cap.payload).toBe(false);
    expect(cap.payload.notification_preferences.matches).toBe(true);
  });
});
