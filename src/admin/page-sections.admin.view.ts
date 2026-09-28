import type { ItemStats } from "../services/page-section-events.service.js";
import type { AdminSectionItem, CatalogOption } from "../services/page-sections-admin.service.js";
import { AppError } from "../utils/errors.js";
import { SECTION_LIMITS, type AppRoute, type Targeting } from "../utils/page-sections.js";

/**
 * Backoffice "Sayfa bölümleri" ekranlarının sunum katmanı: ekran mesajları + servis hatası → mesaj kodu,
 * etiketler, hedefleme özeti, kart satırları. İstek akışı (form doğrulama, servis çağrısı, yönlendirme)
 * `page-sections.admin.controller.ts`'te.
 */

export const SECTIONS_ERRORS: Record<string, string> = {
  invalid_input: "Form geçersiz — alanları kontrol et.",
  not_found: "Bölüm ya da kart bulunamadı.",
  section_limit: `Bu sayfada en fazla ${SECTION_LIMITS.sectionsPerPage} bölüm olabilir.`,
  item_limit: `Aktif kart sınırı dolu (carousel ${SECTION_LIMITS.carouselItems}, öne çıkanlar ${SECTION_LIMITS.featuredItems}) — önce birini pasifleştir.`,
  target_invalid: "Hedef ürün bulunamadı, silinmiş ya da bölümün ülkelerinde değil.",
  image_required: "Banner görseli zorunlu.",
  image_invalid: "Görsel okunamadı ya da 8 MB'tan büyük — JPG, PNG ya da WEBP yükle.",
  failed: "İşlem başarısız oldu, sunucu loglarına bak.",
};

export const SECTIONS_NOTICES: Record<string, string> = {
  saved: "Kaydedildi.",
  deleted: "Silindi.",
  published: "Yayınlandı — uygulamada en geç 60 sn içinde görünür.",
  drafted: "Taslağa alındı — yalnız test admin görür.",
};

/** Servis hatasını ekran koduna çevirir; beklenmeyen hata loglanır. */
export function sectionsErrorCode(err: unknown, context: string): string {
  if (err instanceof AppError) {
    switch (err.code) {
      case "VALIDATION_ERROR": return "invalid_input";
      case "PAGE_SECTION_NOT_FOUND": return "not_found";
      case "PAGE_SECTION_LIMIT": return "section_limit";
      case "PAGE_SECTION_ITEM_LIMIT": return "item_limit";
      case "PAGE_SECTION_TARGET_INVALID": return "target_invalid";
      case "PAGE_SECTION_IMAGE_REQUIRED": return "image_required";
      case "INVALID_FILE_TYPE": return "image_invalid";
    }
  }
  console.error(`[Admin] page sections ${context} failed:`, err);
  return "failed";
}

const EMPTY_STATS: ItemStats = { impressions: 0, clicks: 0, redemptions: 0, breakdown: [] };

export const APP_ROUTE_LABELS: Record<AppRoute, string> = {
  diamonds: "Elmaslar",
  exchange: "Takas / Güçler",
  subscription: "Abonelik",
  discover: "Keşfet",
  rewards_redemptions: "Hediye kartlarım",
};

/** "TH, ID · Android · tüm diller" — liste ve kart tablosu için hedefleme özeti. */
export function targetingSummary(target: Targeting): string {
  const part = (list: string[] | null, all: string, label: (v: string) => string = (v) => v) =>
    list && list.length > 0 ? list.map(label).join(", ") : all;
  return [
    part(target.countries, "tüm ülkeler"),
    part(target.platforms, "tüm platformlar", (p) => (p === "ios" ? "iOS" : "Android")),
    part(target.locales, "tüm diller"),
  ].join(" · ");
}

/** "GRAB · TH · 50 THB (pasif)" — ürün seçenekleri ve öne çıkan kart satırı için tek etiket. */
export function productLabel(o: CatalogOption): string {
  return `${o.brand_key} · ${o.country_code} · ${o.face_value} ${o.currency}${o.is_active ? "" : " (pasif)"}`;
}

/** Kart satırının adı: öne çıkan ürün → ürün etiketi; banner → TR ya da EN (yoksa ilk) başlık. */
export function cardLabel(item: AdminSectionItem, products: Map<string, string>): string {
  if (item.catalog_item_id) return products.get(item.catalog_item_id) ?? "(ürün bulunamadı)";
  const texts = item.content ?? {};
  const title = texts.tr?.title ?? texts.en?.title ?? Object.values(texts).find((t) => t?.title)?.title;
  return title ?? "(başlıksız)";
}

export type SectionItemRowView = AdminSectionItem & { label: string; targeting: string; stats: ItemStats };

/** Bölüm sayfasının kart tablosu: etiket, hedefleme özeti ve ölçüm (olayı olmayan kart → sıfırlar). */
export function sectionItemRows(
  items: AdminSectionItem[],
  stats: Map<string, ItemStats>,
  products: Map<string, string>,
): SectionItemRowView[] {
  return items.map((item) => ({
    ...item,
    label: cardLabel(item, products),
    targeting: targetingSummary(item),
    stats: stats.get(item.id) ?? EMPTY_STATS,
  }));
}
