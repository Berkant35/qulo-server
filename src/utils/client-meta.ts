import type { IncomingHttpHeaders } from "http";

/**
 * Istemcinin basliklarla kendini tanitmasi: `x-app-platform`, `x-app-version`.
 *
 * Denetim kayitlarina (riza) yazildigi icin DB'ye gitmeden once dogrulanir.
 * `user_consents.platform` ios/android/web CHECK kisitina tabi — dogrulanmamis bir
 * deger upsert'i patlatir ve kayit fire-and-forget oldugundan o kullanicinin
 * rizasi SESSIZCE kaybolur. Taninmayan deger → alan hic yazilmaz, kayit yine olur.
 */

const PLATFORMS = ["ios", "android", "web"] as const;
export type ClientPlatform = (typeof PLATFORMS)[number];

export interface ClientMeta {
  platform?: ClientPlatform;
  appVersion?: string;
}

/** "2.0.10" ya da "2.0.10+73" — serbest metin denetim kaydina girmesin. */
const APP_VERSION = /^\d+(\.\d+){0,3}(\+\d+)?$/;
/** Silme geri bildirimindeki app_version siniriyla ayni (user.validator). */
const APP_VERSION_MAX = 20;

function isPlatform(value: string | undefined): value is ClientPlatform {
  return (PLATFORMS as readonly string[]).includes(value ?? "");
}

function readHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value.trim() : undefined;
}

export function clientMetaFromHeaders(headers: IncomingHttpHeaders): ClientMeta {
  const platform = readHeader(headers, "x-app-platform")?.toLowerCase();
  const appVersion = readHeader(headers, "x-app-version");

  const meta: ClientMeta = {};
  if (isPlatform(platform)) meta.platform = platform;
  if (appVersion && appVersion.length <= APP_VERSION_MAX && APP_VERSION.test(appVersion)) {
    meta.appVersion = appVersion;
  }
  return meta;
}

/** Sesli/gorselli soru icin asgari istemci surumu (2.0.18+100 medya UI'sizdir → build sarti sart). */
export const MEDIA_QUESTIONS_MIN_CLIENT = "2.0.18+101";

function numericParts(version: string): number[] | null {
  const core = version.split("+")[0];
  if (!/^\d+(\.\d+){0,3}$/.test(core)) return null;
  return core.split(".").map(Number);
}

function buildNumber(version: string): number | null {
  const raw = version.split("+")[1];
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
}

/**
 * Istemci surumu >= min mi? `min` `+build` icermiyorsa build yok sayilir. Icerirse sayisal parcalar
 * esitken istemcinin build'i >= min build olmali (build'i olmayan istemci → false). Yok/bozuksa false.
 */
export function isClientAtLeast(meta: ClientMeta, min: string): boolean {
  const have = meta.appVersion ? numericParts(meta.appVersion) : null;
  const need = numericParts(min);
  if (!have || !need) return false;
  const len = Math.max(have.length, need.length);
  for (let i = 0; i < len; i++) {
    const a = have[i] ?? 0;
    const b = need[i] ?? 0;
    if (a !== b) return a > b;
  }
  const needBuild = buildNumber(min);
  if (needBuild === null) return true;
  const haveBuild = buildNumber(meta.appVersion as string);
  return haveBuild !== null && haveBuild >= needBuild;
}
