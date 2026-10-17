import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FailureSpec } from "../helpers/fake-supabase.js";

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

/** Gerçek economy servisi + sahte Supabase ile `GET /app/economy` gövdesi. */
async function economyBodyFor(powers: Array<Record<string, unknown>>) {
  // Üstteki blokların servis mock'ları (doMock) resetModules'tan sağ çıkar — gerçek servis gerekli.
  vi.doUnmock("../../src/services/economy-config.service.js");
  vi.doUnmock("../../src/services/app-config.service.js");
  const { createFakeSupabase } = await import("../helpers/fake-supabase.js");
  const { activeConfigRow } = await import("../helpers/economy-config.fixture.js");
  const fake = createFakeSupabase({ economy_config_versions: [activeConfigRow()], powers });
  vi.doMock("../../src/config/supabase.js", () => ({ supabase: fake.client }));
  const { getEconomyConfigHandler } = await import("../../src/controllers/app.controller.js");
  const res: any = { json: vi.fn() };
  const next = vi.fn();

  await getEconomyConfigHandler({ headers: {} } as any, res, next);

  expect(next).not.toHaveBeenCalled();
  return res.json.mock.calls[0][0];
}

describe("getEconomyConfigHandler — herkese açık görünüm", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("yanıtta rainbow bloğu YOK; core/powerCosts/subscriptionLimits ve sürüm var", async () => {
    const body = await economyBodyFor([]);

    expect(body.config).not.toHaveProperty("rainbow");
    expect(body.config).toHaveProperty("core");
    expect(body.config).toHaveProperty("powerCosts");
    expect(body.config).toHaveProperty("subscriptionLimits");
    expect(body.config).toHaveProperty("rewards");
    expect(body).toHaveProperty("version");
  });

  /**
   * Mobil auth öncesi "güç demosu" Kâhin doğruluğunu buradan okur. Değer config'in İÇİNE girmez
   * (zod şemasına eklenseydi aktif satır parse edilemeyip sohbet akışı 500 verirdi) — üst seviye alan.
   */
  it("economy yanıtı oracleAccuracy döndürür (powers tablosundan, üst seviye alan)", async () => {
    const body = await economyBodyFor([{ name: "ORACLE", accuracy_rate: "0.85" }]);

    // Varsayılan 0.7'den FARKLI değer: sabiti dönen bir gerçekleme bu testi geçemez.
    expect(body.oracleAccuracy).toBe(0.85);
    expect(body.config.rainbow).toBeUndefined();
    expect(body.config).not.toHaveProperty("oracleAccuracy");
  });

  it("prod biçimi: accuracy_rate '0.70' (metin) → 0.7 sayısı", async () => {
    const body = await economyBodyFor([{ name: "ORACLE", accuracy_rate: "0.70" }]);

    expect(body.oracleAccuracy).toBe(0.7);
    expect(typeof body.oracleAccuracy).toBe("number");
  });

  it("powers satırı yoksa oracleAccuracy 0.7", async () => {
    const body = await economyBodyFor([{ name: "HALF", accuracy_rate: null }]);

    expect(body.oracleAccuracy).toBe(0.7);
  });

  it("accuracy_rate 1.4 ise 1'e sıkıştırılır", async () => {
    const body = await economyBodyFor([{ name: "ORACLE", accuracy_rate: "1.4" }]);

    expect(body.oracleAccuracy).toBe(1);
  });

  it("negatif accuracy_rate 0'a sıkıştırılır", async () => {
    const body = await economyBodyFor([{ name: "ORACLE", accuracy_rate: "-0.2" }]);

    expect(body.oracleAccuracy).toBe(0);
  });

  it.each([[null], ["abc"]])("sayıya çevrilemeyen accuracy_rate (%j) → 0.7, 0'a düşmez", async (bozuk) => {
    const body = await economyBodyFor([{ name: "ORACLE", accuracy_rate: bozuk }]);

    expect(body.oracleAccuracy).toBe(0.7);
  });
});

/** Gerçek app-config servisi + sahte Supabase ile `GET /app/config` gövdesi. */
async function configBodyFor(
  row: Record<string, unknown>,
  failOn: FailureSpec[] = [],
) {
  // Üstteki blokların servis mock'ları (doMock) resetModules'tan sağ çıkar — gerçek servis gerekli.
  vi.doUnmock("../../src/services/app-config.service.js");
  vi.doUnmock("../../src/services/economy-config.service.js");
  const { createFakeSupabase } = await import("../helpers/fake-supabase.js");
  const fake = createFakeSupabase({ app_config: [row] }, { failOn });
  vi.doMock("../../src/config/supabase.js", () => ({ supabase: fake.client }));
  const { getAppConfigHandler } = await import("../../src/controllers/app.controller.js");
  const res: any = { json: vi.fn() };
  const next = vi.fn();

  await getAppConfigHandler({ headers: { "x-app-platform": "ios" } } as any, res, next);

  expect(next).not.toHaveBeenCalled();
  return res.json.mock.calls[0][0];
}

const CONFIG_SATIRI = {
  id: "cfg", min_version_ios: "2.0.0", min_version_android: "2.0.0",
  latest_version_ios: "2.0.15", latest_version_android: "2.0.15",
  store_url_ios: "ios-url", store_url_android: "android-url", is_maintenance: false,
  maintenance_message_tr: null, maintenance_message_en: null, is_force_update_enabled: false,
  seed_reply_enabled: true, seed_reply_fast_mode: false, photo_moderation_enabled: true,
  updated_at: "2026-10-17T00:00:00Z",
};

/**
 * Mobil splash'te çekilen auth'suz uç: güç demosu uzaktan kapatma anahtarı (spec 2026-10-17 §7.1).
 * Anahtar yoksa / okunamazsa demo AÇIK kalır (çevrimdışı ilk açılışta demo görünür).
 */
describe("getAppConfigHandler — powerDemoEnabled (migration 078)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("powerDemoEnabled varsayılan true (kolon yok → 42703)", async () => {
    // Yalnız kolon okuması 42703 verir (ilk select = satır başarılı): migration deploy'dan sonra gelirse.
    const body = await configBodyFor(CONFIG_SATIRI, [
      { table: "app_config", op: "select", failAfter: 1, error: { message: "column does not exist", code: "42703" } },
    ]);

    expect(body.powerDemoEnabled).toBe(true);
    expect(body.latestVersion).toBe("2.0.15");   // kolon yokluğu geri kalan config'i bozmaz
  });

  it("satırda power_demo_enabled=false ise false", async () => {
    const body = await configBodyFor({ ...CONFIG_SATIRI, power_demo_enabled: false });

    expect(body.powerDemoEnabled).toBe(false);
  });

  it("satırda power_demo_enabled=true ise true; mevcut alanlar yerinde", async () => {
    const body = await configBodyFor({ ...CONFIG_SATIRI, power_demo_enabled: true });

    expect(body.powerDemoEnabled).toBe(true);
    expect(body).toMatchObject({ minVersion: "2.0.0", storeUrl: "ios-url", isMaintenance: false });
  });

  it("app_config okunamıyorsa (varsayılan yanıt) powerDemoEnabled yine true — sözleşme alanı hep var", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = await configBodyFor(CONFIG_SATIRI, [{ table: "app_config", op: "select" }]);

    expect(body.minVersion).toBe("0.0.0");
    expect(body.powerDemoEnabled).toBe(true);
  });
});
