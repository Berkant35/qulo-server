import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Kontrolor dikisi: spec bolum 6'nin istedigi ucuncu test — data.locale ?? detectLocale(req)
 * satirinin, header'in gercekten servise ulastigi tek yer. tests/routes/unsubscribe.test.ts'deki
 * desen izleniyor: sahte req/res, servis modulu vi.doMock'lanip handler dinamik import ediliyor.
 */

function makeRes() {
  const json = vi.fn();
  const res: any = { json };
  return { res, json };
}

describe("socialLoginHandler — locale dikisi", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadHandlerWithMockedService() {
    const socialLoginMock = vi.fn().mockResolvedValue({
      accessToken: "a", refreshToken: "r", userId: "u1", profileIncomplete: false,
    });
    vi.doMock("../../src/services/auth.service.js", () => ({
      authService: { socialLogin: socialLoginMock },
    }));
    const { socialLoginHandler } = await import("../../src/controllers/auth.controller.js");
    return { socialLoginHandler, socialLoginMock };
  }

  it("body\'da locale varsa header yoksayilir", async () => {
    const { socialLoginHandler, socialLoginMock } = await loadHandlerWithMockedService();
    const { res } = makeRes();
    const req: any = {
      body: { provider: "google", id_token: "tok", locale: "de" },
      headers: { "accept-language": "fr" },
    };
    const next = vi.fn();

    await socialLoginHandler(req, res, next);

    expect(socialLoginMock).toHaveBeenCalledWith(expect.objectContaining({ locale: "de" }));
    expect(next).not.toHaveBeenCalled();
  });

  it("body\'da locale yoksa Accept-Language header\'inden cozulur", async () => {
    const { socialLoginHandler, socialLoginMock } = await loadHandlerWithMockedService();
    const { res } = makeRes();
    const req: any = {
      body: { provider: "google", id_token: "tok" },
      headers: { "accept-language": "fr-FR,fr;q=0.9" },
    };
    const next = vi.fn();

    await socialLoginHandler(req, res, next);

    expect(socialLoginMock).toHaveBeenCalledWith(expect.objectContaining({ locale: "fr" }));
  });

  /**
   * Eski istemci kurali: ne body'de locale ne de Accept-Language header'i varsa
   * (store'daki mevcut mobil surumler) dal oncesi varsayilan (tr) korunmali —
   * bkz. LEGACY_CLIENT_LOCALE / src/utils/locales.ts. Bu satir olmadan 'en' donerdi.
   */
  it("ne body\'de locale ne header var — eski istemci varsayilani (tr)", async () => {
    const { socialLoginHandler, socialLoginMock } = await loadHandlerWithMockedService();
    const { res } = makeRes();
    const req: any = {
      body: { provider: "google", id_token: "tok" },
      headers: {},
    };
    const next = vi.fn();

    await socialLoginHandler(req, res, next);

    expect(socialLoginMock).toHaveBeenCalledWith(expect.objectContaining({ locale: "tr" }));
  });
});
