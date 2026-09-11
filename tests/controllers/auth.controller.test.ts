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

    expect(socialLoginMock).toHaveBeenCalledWith(expect.objectContaining({ locale: "de" }), expect.anything());
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

    expect(socialLoginMock).toHaveBeenCalledWith(expect.objectContaining({ locale: "fr" }), expect.anything());
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

    expect(socialLoginMock).toHaveBeenCalledWith(expect.objectContaining({ locale: "tr" }), expect.anything());
  });
});

/**
 * Riza denetim izi dikisi: istemci basliklari (platform + surum) servise ulasiyor mu?
 * IP BILINCLI OLARAK gecmez — gizlilik politikasi IP toplamayi aciklamiyor.
 *
 * `toHaveBeenCalledWith` degeri undefined olan anahtarlari yok sayar; bu yuzden meta'nin
 * anahtar kumesi ayrica iddia ediliyor. IP hangi kaynaktan okunursa okunsun (req.ip,
 * x-forwarded-for) meta'ya eklenen her anahtar bu testleri kirmiziya dondurur.
 */
describe("kayit rizasi — istemci meta dikisi", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const headers = {
    "x-app-platform": "ios", "x-app-version": "2.0.10+73", "x-forwarded-for": "203.0.113.7",
  };
  const expectedMeta = { platform: "ios", appVersion: "2.0.10+73" };
  const metaKeys = (mock: ReturnType<typeof vi.fn>) => Object.keys(mock.mock.calls[0][1]).sort();

  async function loadHandlers() {
    const registerMock = vi.fn().mockResolvedValue({ userId: "u1" });
    const socialLoginMock = vi.fn().mockResolvedValue({
      accessToken: "a", refreshToken: "r", userId: "u1", profileIncomplete: false,
    });
    vi.doMock("../../src/services/auth.service.js", () => ({
      authService: { register: registerMock, socialLogin: socialLoginMock },
    }));
    const handlers = await import("../../src/controllers/auth.controller.js");
    return { ...handlers, registerMock, socialLoginMock };
  }

  it("registerHandler basliklardaki platform + surumu servise gecirir, IP'yi gecirmez", async () => {
    const { registerHandler, registerMock } = await loadHandlers();
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const req: any = { body: { email: "a@qulo.test" }, headers, ip: "203.0.113.7" };

    await registerHandler(req, res, vi.fn());

    expect(registerMock).toHaveBeenCalledWith(req.body, expectedMeta);
    expect(metaKeys(registerMock)).toEqual(["appVersion", "platform"]);
  });

  it("socialLoginHandler basliklardaki platform + surumu servise gecirir, IP'yi gecirmez", async () => {
    const { socialLoginHandler, socialLoginMock } = await loadHandlers();
    const { res } = makeRes();
    const req: any = {
      body: { provider: "google", id_token: "tok", locale: "de" }, headers, ip: "203.0.113.7",
    };

    await socialLoginHandler(req, res, vi.fn());

    expect(socialLoginMock).toHaveBeenCalledWith(expect.objectContaining({ locale: "de" }), expectedMeta);
    expect(metaKeys(socialLoginMock)).toEqual(["appVersion", "platform"]);
  });
});
