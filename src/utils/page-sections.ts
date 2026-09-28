import { SUPPORTED_LOCALES, type SupportedLocale } from "../constants/locales.js";
import type { ClientPlatform } from "./client-meta.js";

/**
 * Sayfa bölümleri (page builder) — saf kurallar (spec 2026-09-28 §3, §5.2). Servisler DB'den okur,
 * burası görüntüleyene ne gösterileceğine karar verir: durum, hedefleme, dil, kart çözümü, sınırlar.
 * DB CHECK'leri (migration 071) ile aynı listeler.
 */

export const PAGE_KEYS = ["rewards_market"] as const;
export type PageKey = (typeof PAGE_KEYS)[number];
/** Rainbow market ekranı — market yanıtı, itfa kaynak kartı, olaylar ve backoffice aynı sayfayı okur. */
export const REWARDS_MARKET_PAGE: PageKey = "rewards_market";

export const SECTION_TYPES = ["banner_carousel", "featured_items"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const SECTION_STATUSES = ["draft", "published"] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];

export const TARGET_PLATFORMS = ["ios", "android"] as const;
export type TargetPlatform = (typeof TARGET_PLATFORMS)[number];

/** Banner butonunun açabileceği uygulama içi sayfalar (mobil yönlendirme tablosuyla aynı liste). */
export const APP_ROUTES = ["diamonds", "exchange", "subscription", "discover", "rewards_redemptions"] as const;
export type AppRoute = (typeof APP_ROUTES)[number];

export const ACTION_TYPES = ["none", "catalog_item", "app_route"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const SECTION_LIMITS = {
  sectionsPerPage: 10,
  carouselItems: 8,
  featuredItems: 12,
  headingLength: 40,
  titleLength: 60,
  subtitleLength: 120,
  ctaLength: 24,
} as const;

export type LocalizedText = Partial<Record<SupportedLocale, string>>;
export interface BannerText {
  title?: string;
  subtitle?: string;
  cta_label?: string;
}
export type BannerContent = Partial<Record<SupportedLocale, BannerText>>;

/** NULL ya da boş liste = hepsi. */
export interface Targeting {
  countries: string[] | null;
  platforms: string[] | null;
  locales: string[] | null;
}

export interface SectionRow extends Targeting {
  id: string;
  page_key: PageKey;
  section_type: SectionType;
  heading: LocalizedText | null;
  sort_order: number;
  status: SectionStatus;
  autoplay_seconds: number;
}

export interface SectionItemRow extends Targeting {
  id: string;
  section_id: string;
  sort_order: number;
  is_active: boolean;
  image_url: string | null;
  content: BannerContent | null;
  action_type: ActionType;
  action_catalog_item_id: string | null;
  action_route: string | null;
  catalog_item_id: string | null;
}

/**
 * Görüntüleyen. `country: null` = ülke süzmesi yok (test admin önizlemede "Tümü"); normal kullanıcı
 * her zaman kendi ülkesiyle gelir (erişim kuralı ülke ister).
 */
export interface ViewerContext {
  country: string | null;
  platform: TargetPlatform | null;
  locale: SupportedLocale;
  isTestAdmin: boolean;
}

export type BannerAction<T> =
  | { type: "none" }
  | { type: "catalog_item"; catalog_item: T }
  | { type: "app_route"; route: AppRoute };

export interface BannerItemView<T> {
  id: string;
  image_url: string;
  title: string;
  subtitle: string | null;
  cta_label: string | null;
  action: BannerAction<T>;
}

export interface FeaturedItemView<T> {
  id: string;
  catalog_item: T;
}

export type PageSectionView<T> =
  | {
      id: string;
      type: "banner_carousel";
      heading: string | null;
      is_draft: boolean;
      autoplay_seconds: number;
      items: BannerItemView<T>[];
    }
  | {
      id: string;
      type: "featured_items";
      heading: string | null;
      is_draft: boolean;
      items: FeaturedItemView<T>[];
    };

export function toTargetPlatform(platform?: ClientPlatform): TargetPlatform | null {
  return platform === "ios" || platform === "android" ? platform : null;
}

function hasValues(list: string[] | null | undefined): list is string[] {
  return Array.isArray(list) && list.length > 0;
}

export function matchesTargeting(target: Targeting, ctx: ViewerContext): boolean {
  if (hasValues(target.countries) && ctx.country !== null && !target.countries.includes(ctx.country)) return false;
  if (hasValues(target.platforms) && (ctx.platform === null || !target.platforms.includes(ctx.platform))) return false;
  if (hasValues(target.locales) && !target.locales.includes(ctx.locale)) return false;
  return true;
}

/**
 * Dil seçimi: kullanıcının dili → `en` → `SUPPORTED_LOCALES` sırasıyla ilk dolu dil (jsonb anahtar sırası
 * tanımsız olduğu için "ilk" sabit bir listeden gelir). Hiçbiri yoksa null.
 */
export function pickLocalized<V>(
  values: Partial<Record<string, V>> | null | undefined,
  locale: SupportedLocale,
  isFilled: (value: V) => boolean,
): V | null {
  if (!values || typeof values !== "object") return null;
  for (const key of [locale, "en", ...SUPPORTED_LOCALES]) {
    const value = values[key];
    if (value !== undefined && value !== null && isFilled(value)) return value;
  }
  return null;
}

const isFilledText = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;
const optionalText = (value: unknown): string | null => (isFilledText(value) ? (value as string).trim() : null);
const isAppRoute = (value: unknown): value is AppRoute => (APP_ROUTES as readonly unknown[]).includes(value);

/** Bölüm/kart sırası: `sort_order`, eşitlikte id (deterministik) — okuma ve backoffice sıralaması aynı kural. */
export function byOrder(a: { sort_order: number; id: string }, b: { sort_order: number; id: string }): number {
  return a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function headingFor(section: SectionRow, locale: SupportedLocale): string | null {
  const heading = pickLocalized<string>(section.heading, locale, isFilledText);
  return heading === null ? null : heading.trim();
}

function bannerAction<T>(card: SectionItemRow, catalog: ReadonlyMap<string, T>): BannerAction<T> | null {
  switch (card.action_type) {
    case "none":
      return { type: "none" };
    case "catalog_item": {
      const item = card.action_catalog_item_id ? catalog.get(card.action_catalog_item_id) : undefined;
      return item === undefined ? null : { type: "catalog_item", catalog_item: item };
    }
    case "app_route":
      return isAppRoute(card.action_route) ? { type: "app_route", route: card.action_route } : null;
    default:
      return null;
  }
}

function bannerItem<T>(
  card: SectionItemRow,
  catalog: ReadonlyMap<string, T>,
  locale: SupportedLocale,
): BannerItemView<T> | null {
  if (!card.image_url) return null;
  const text = pickLocalized<BannerText>(
    card.content,
    locale,
    (t) => typeof t === "object" && t !== null && isFilledText(t.title),
  );
  if (!text) return null;
  const action = bannerAction(card, catalog);
  if (!action) return null;
  return {
    id: card.id,
    image_url: card.image_url,
    title: (text.title as string).trim(),
    subtitle: optionalText(text.subtitle),
    cta_label: optionalText(text.cta_label),
    action,
  };
}

function bannerSection<T>(
  section: SectionRow,
  cards: SectionItemRow[],
  catalog: ReadonlyMap<string, T>,
  ctx: ViewerContext,
): PageSectionView<T> | null {
  const items: BannerItemView<T>[] = [];
  for (const card of cards) {
    if (items.length >= SECTION_LIMITS.carouselItems) break;
    const view = bannerItem(card, catalog, ctx.locale);
    if (view) items.push(view);
  }
  if (items.length === 0) return null;
  return {
    id: section.id,
    type: "banner_carousel",
    heading: headingFor(section, ctx.locale),
    is_draft: section.status === "draft",
    autoplay_seconds: section.autoplay_seconds,
    items,
  };
}

function featuredSection<T>(
  section: SectionRow,
  cards: SectionItemRow[],
  catalog: ReadonlyMap<string, T>,
  ctx: ViewerContext,
): PageSectionView<T> | null {
  const items: FeaturedItemView<T>[] = [];
  for (const card of cards) {
    if (items.length >= SECTION_LIMITS.featuredItems) break;
    const item = card.catalog_item_id ? catalog.get(card.catalog_item_id) : undefined;
    if (item !== undefined) items.push({ id: card.id, catalog_item: item });
  }
  if (items.length === 0) return null;
  return {
    id: section.id,
    type: "featured_items",
    heading: headingFor(section, ctx.locale),
    is_draft: section.status === "draft",
    items,
  };
}

/**
 * Görüntüleyenin göreceği bölümler (spec §3). `catalog` = bu görüntüleyenin markette gördüğü ürünler
 * (aktif + silinmemiş + etkin ülke); hedefi burada olmayan kart düşer, kartı kalmayan bölüm yanıtta yer
 * almaz. Taslak yalnız test admin'e. Sınırlar DB'deki fazlalığa karşı savunma (backoffice de uygular).
 */
export function resolveSections<T>(
  sections: readonly SectionRow[],
  items: readonly SectionItemRow[],
  catalog: ReadonlyMap<string, T>,
  ctx: ViewerContext,
): PageSectionView<T>[] {
  const bySection = new Map<string, SectionItemRow[]>();
  for (const item of items) {
    const list = bySection.get(item.section_id) ?? [];
    list.push(item);
    bySection.set(item.section_id, list);
  }

  const visible = sections
    .filter((s) => s.status === "published" || (s.status === "draft" && ctx.isTestAdmin))
    .filter((s) => matchesTargeting(s, ctx))
    .sort(byOrder);

  const views: PageSectionView<T>[] = [];
  for (const section of visible) {
    if (views.length >= SECTION_LIMITS.sectionsPerPage) break;
    const cards = (bySection.get(section.id) ?? [])
      .filter((card) => card.is_active && matchesTargeting(card, ctx))
      .sort(byOrder);
    const view =
      section.section_type === "banner_carousel" ? bannerSection(section, cards, catalog, ctx)
      : section.section_type === "featured_items" ? featuredSection(section, cards, catalog, ctx)
      : null;
    if (view) views.push(view);
  }
  return views;
}
