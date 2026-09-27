import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * app-config platform dikisi. Zorunlu guncelleme esigi ve magaza linki platforma
 * gore donuyor: platform yanlis cozulurse iOS kullanicisina Android'in minimum
 * surumu gosterilir. Baslik `utils/client-meta` ile okunuyor (tek dogruluk kaynagi);
 * app-config yalnizca ios/android bildigi icin geri kalan her sey android'e duser.
 */

async function platformFor(headers: Record<string, string>) {
  const getConfig = vi.fn().mockResolvedValue({});
  vi.doMock("../../src/services/app-config.service.js", () => ({ appConfigService: { getConfig } }));
  vi.doMock("../../src/services/economy-config.service.js", () => ({
    economyConfigService: { getActiveConfig: vi.fn() },
  }));
  const { getAppConfigHandler } = await import("../../src/controllers/app.controller.js");
  const res: any = { json: vi.fn() };
  const next = vi.fn();

  await getAppConfigHandler({ headers } as any, res, next);

  expect(next).not.toHaveBeenCalled();
  return getConfig.mock.calls[0][0];
}

describe("getAppConfigHandler — platform", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("ios basligi → ios", async () => {
    expect(await platformFor({ "x-app-platform": "ios" })).toBe("ios");
  });

  it("android basligi → android", async () => {
    expect(await platformFor({ "x-app-platform": "android" })).toBe("android");
  });

  it("baslik yoksa (eski istemci) → android", async () => {
    expect(await platformFor({})).toBe("android");
  });

  it("buyuk harf ve bosluk tolere edilir — ' iOS ' → ios", async () => {
    // Eskiden ham string karsilastiriliyordu; ' iOS ' android'e dusup iOS
    // kullanicisina yanlis zorunlu guncelleme esigi gosterirdi.
    expect(await platformFor({ "x-app-platform": " iOS " })).toBe("ios");
  });

  it("web → android — app-config yalnizca ios/android bilir", async () => {
    expect(await platformFor({ "x-app-platform": "web" })).toBe("android");
  });

  it("taninmayan deger → android", async () => {
    expect(await platformFor({ "x-app-platform": "windows" })).toBe("android");
  });
});

describe("getEconomyConfigHandler — herkese açık görünüm", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("yanıtta rainbow bloğu YOK; core/powerCosts/subscriptionLimits ve sürüm var", async () => {
    // Üstteki blokların servis mock'ları (doMock) resetModules'tan sağ çıkar — gerçek servis gerekli.
    vi.doUnmock("../../src/services/economy-config.service.js");
    vi.doUnmock("../../src/services/app-config.service.js");
    const { createFakeSupabase } = await import("../helpers/fake-supabase.js");
    const { activeConfigRow } = await import("../helpers/economy-config.fixture.js");
    const fake = createFakeSupabase({ economy_config_versions: [activeConfigRow()] });
    vi.doMock("../../src/config/supabase.js", () => ({ supabase: fake.client }));
    const { getEconomyConfigHandler } = await import("../../src/controllers/app.controller.js");
    const res: any = { json: vi.fn() };
    const next = vi.fn();

    await getEconomyConfigHandler({ headers: {} } as any, res, next);

    expect(next).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.config).not.toHaveProperty("rainbow");
    expect(body.config).toHaveProperty("core");
    expect(body.config).toHaveProperty("powerCosts");
    expect(body.config).toHaveProperty("subscriptionLimits");
    expect(body.config).toHaveProperty("rewards");
    expect(body).toHaveProperty("version");
  });
});
