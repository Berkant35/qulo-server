import type { ClientMeta } from "./client-meta.js";

/**
 * Magaza test botu tespiti — `users.is_store_bot` (migration 085).
 *
 * Google Play her build yuklemesinde (internal track dahil) uygulamayi Firebase Test Lab
 * cihazlarinda otomatik gezer; bu cihazlar gercek gibi kayit acar ve kayit/tutma
 * metriklerini sisirir (2026-11-16: 15 sahte kayit). Bayrak YALNIZ metrik ayiklamasidir:
 * uygulama davranisina (Discover, Rainbow, moderasyon) dokunmaz — `is_test_account`
 * bu yuzden kullanilmaz (Rainbow'u acar, foto moderasyonunu atlar → inceleme riski).
 *
 * Imzalar (canli veriyle dogrulandi 2026-11-17):
 * - `x-test-lab: 1` basligi (Android istemci Test Lab'i kendisi bildirir) — kesin sinyal.
 * - `@cloudtestlabaccounts.com` — Test Lab'in Google hesaplari.
 * - Android + `adsoyad.12345@gmail.com` — on-lansman cihazlarinin Google hesap kalibi.
 *   iOS'ta bu kalip gercek kullanici olabilir; yalniz Android'de sayilir.
 */
const TEST_LAB_DOMAIN = "@cloudtestlabaccounts.com";
const PRELAUNCH_GMAIL = /^[a-z]+\.\d{5}@gmail\.com$/;

export function isStoreBot(email: string | null | undefined, client: ClientMeta = {}): boolean {
  if (client.testLab) return true;
  const normalized = (email ?? "").trim().toLowerCase();
  if (normalized.endsWith(TEST_LAB_DOMAIN)) return true;
  return client.platform === "android" && PRELAUNCH_GMAIL.test(normalized);
}
