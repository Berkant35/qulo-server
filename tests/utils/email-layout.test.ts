import { describe, it, expect, vi, beforeEach } from "vitest";
import { SUPPORTED_LOCALES } from "../../src/constants/locales.js";
import { emailLocales } from "../../src/utils/email-locales.js";
import { escapeHtml, renderEmailLayout } from "../../src/utils/email-layout.js";

const XSS = `<script>alert(1)</script><img src=x onerror="alert(2)">`;

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
}

describe("renderEmailLayout", () => {
  const base = {
    locale: "en",
    preheader: "Pre text",
    title: "Başlık",
    paragraphs: ["Birinci", "İkinci"],
    footerLines: ["Footer satiri"],
  };

  it("zorunlu parcalar: buton href, baslik, preheader, alt metin, 600px, JS yok", () => {
    const html = renderEmailLayout({
      ...base,
      tagline: "Tag",
      button: { label: "Git", url: "https://quloapp.com/matches" },
    });
    expect(html).toContain('href="https://quloapp.com/matches"');
    expect(html).toContain(">Git</a>");
    expect(html).toContain("Pre text");
    expect(html).toContain("<h1");
    expect(html).toContain('width="600"');
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("Poppins,Helvetica,Arial");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i); // harici gorsel yok; img olursa alt zorunlu
  });

  it("kullanici girdisi (baslik, paragraf, vurgu, buton etiketi, alt bilgi) ham gecmez", () => {
    const html = renderEmailLayout({
      ...base,
      preheader: XSS,
      title: XSS,
      paragraphs: [XSS],
      highlight: { label: XSS, text: XSS },
      button: { label: XSS, url: "https://quloapp.com/a?x=1&y=<2>" },
      footerLines: [XSS],
      footerLink: { label: XSS, url: "https://quloapp.com/u" },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onerror="');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&amp;y=&lt;2&gt;"); // href de kacislanir
  });

  it("satir sonu <br> olur ve yine kacislanir", () => {
    const html = renderEmailLayout({ ...base, paragraphs: ["a\n<b>b</b>"] });
    expect(html).toContain("a<br>&lt;b&gt;b&lt;/b&gt;");
  });

  it("http(s) disindaki baglanti reddedilir", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "//evil.com"]) {
      expect(() => renderEmailLayout({ ...base, button: { label: "x", url } })).toThrow();
      expect(() => renderEmailLayout({ ...base, footerLink: { label: "x", url } })).toThrow();
    }
  });

  it("ar için dir=rtl, diğer dillerde ltr", () => {
    expect(renderEmailLayout({ ...base, locale: "ar" })).toContain('dir="rtl"');
    expect(renderEmailLayout({ ...base, locale: "ar" })).toContain('lang="ar"');
    expect(renderEmailLayout({ ...base, locale: "tr" })).toContain('dir="ltr"');
  });

  it("escapeHtml bes kritik karakteri cevirir", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("kullanici e-postalari (gercek gonderici + mock gmail)", () => {
  beforeEach(() => vi.resetModules());

  function mockEnv() {
    vi.doMock("../../src/config/env.js", () => ({
      env: {
        APP_URL: "https://api.test",
        WEB_URL: "https://quloapp.com",
        API_BASE_URL: "https://api.test",
        EMAIL_FROM: "info@test",
      },
    }));
    const sendEmail = vi.fn(async () => "id");
    vi.doMock("../../src/utils/gmail.js", () => ({ sendEmail }));
    return sendEmail;
  }
  type Sent = { to: string; subject: string; html: string; text: string };
  const sentOf = (m: ReturnType<typeof vi.fn>) => (m.mock.calls as unknown as Sent[][])[0][0];

  it.each(["tr", "en", "ar"] as const)("dogrulama (%s): buton href, baslik, preheader", async (loc) => {
    const sendEmail = mockEnv();
    const { sendVerificationEmail } = await import("../../src/utils/email.js");
    await sendVerificationEmail("a@b.co", "tok en", loc);
    const { html, subject } = sentOf(sendEmail);
    const strings = JSON.parse(
      (await import("node:fs")).readFileSync(`src/locales/emails/${loc}.json`, "utf-8"),
    );
    expect(subject).toBe(strings.verify_subject);
    expect(html).toContain(strings.verify_title.replace(/'/g, "&#39;"));
    expect(html).toContain('href="https://api.test/api/v1/auth/verify-email?token=tok%20en"');
    expect(html).toContain(loc === "ar" ? 'dir="rtl"' : 'dir="ltr"');
  });

  it.each(["tr", "en"] as const)("sifre sifirlama (%s): web linki + fallback", async (loc) => {
    const sendEmail = mockEnv();
    const { sendPasswordResetEmail } = await import("../../src/utils/email.js");
    await sendPasswordResetEmail("a@b.co", "t1", loc);
    const { html } = sentOf(sendEmail);
    const links = hrefs(html);
    expect(links.filter((l) => l.includes("reset-password?token=t1")).length).toBe(2); // buton + fallback
    expect(new URL(links[0]).hostname).toBe("quloapp.com");
  });

  it("destek yaniti: ad/mesaj HTML enjeksiyonu kacislanir", async () => {
    const sendEmail = mockEnv();
    const { emailService } = await import("../../src/services/email.service.js");
    await emailService.sendTicketReply("a@b.co", XSS, `${XSS}\nikinci`, "12345678-aaaa");
    const { html, text } = sentOf(sendEmail);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<br>ikinci");
    expect(html).toContain("Ticket #12345678");
    expect(text).toContain(XSS); // duz metin parcasi ham kalir (HTML degil)
  });

  describe("yeni eslesme e-postasi, 18 dil", () => {
    for (const loc of SUPPORTED_LOCALES) {
      it(`${loc}: href/preheader/why/unsubscribe, derin baglanti quloapp.com`, async () => {
        const sendEmail = mockEnv();
        vi.doMock("../../src/config/supabase.js", () => ({
          supabase: {
            from: () => ({
              select: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: "u1",
                      email: "a@b.co",
                      locale: loc,
                      last_active_at: null,
                      email_notifications_enabled: true,
                      email_verified: true,
                      is_deleted: false,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          },
        }));
        vi.doMock("../../src/services/email-unsubscribe-token.service.js", () => ({
          emailUnsubscribeTokenService: { create: vi.fn(async () => "utok"), sentWithinDailyWindow: vi.fn(async () => false) },
        }));
        const { matchEmailService } = await import("../../src/services/match-email.service.js");
        await matchEmailService.sendMatchEmail("u1");
        const { html, subject } = sentOf(sendEmail);
        const tpl = emailLocales[loc].match_new;
        expect(subject).toBe(tpl.subject);
        expect(tpl.why.length).toBeGreaterThan(10);
        expect(html).toContain(escapeHtml(tpl.cta));
        expect(html).toContain(escapeHtml(tpl.preheader));
        expect(html).toContain(escapeHtml(tpl.why));
        const links = hrefs(html);
        expect(links).toContain("https://quloapp.com");
        expect(links).toContain("https://api.test/unsubscribe?token=utok");
        // derin baglanti yalniz quloapp.com; geri kalani yalniz unsubscribe API'si
        expect(links.filter((l) => new URL(l).hostname === "quloapp.com").length).toBe(1);
        expect(html).toContain(loc === "ar" ? 'dir="rtl"' : 'dir="ltr"');
      });
    }
  });
});
