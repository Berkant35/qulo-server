import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { TtlCache } from "../utils/ttl-cache.js";
import {
  PAGE_KEYS,
  resolveSections,
  type PageKey,
  type PageSectionView,
  type SectionItemRow,
  type SectionRow,
  type ViewerContext,
} from "../utils/page-sections.js";

/**
 * Sayfa bölümleri — okuma tarafı (spec 2026-09-28 §5.3). Sayfanın taslak dahil tüm silinmemiş bölümleri
 * ve kartları 60 sn süreç içi önbellekte; görüntüleyene göre süzme bellekte (`resolveSections`). Admin
 * yazımları `invalidate()` çağırır; başka replika en geç TTL sonunda görür (maliyet bekçisi).
 */
export const PAGE_SECTIONS_TTL_MS = 60_000;

const SECTION_COLUMNS =
  "id, page_key, section_type, heading, sort_order, status, countries, platforms, locales, autoplay_seconds";
const ITEM_COLUMNS =
  "id, section_id, sort_order, is_active, countries, platforms, locales, image_url, content, action_type, action_catalog_item_id, action_route, catalog_item_id";
/** Yayında ≤ 10 bölüm; taslaklarla birlikte savunma sınırı. */
const SECTION_LOAD_LIMIT = 50;
const ITEM_LOAD_LIMIT = 1000;

export interface PageSnapshot {
  sections: ReadonlyArray<SectionRow>;
  items: ReadonlyArray<SectionItemRow>;
}

const EMPTY_SNAPSHOT: PageSnapshot = { sections: [], items: [] };

class PageSectionsService {
  private readonly cache = new TtlCache<PageKey, PageSnapshot>(PAGE_SECTIONS_TTL_MS, PAGE_KEYS.length);

  /** Paylaşılan görüntü — değiştirme. Okuma hatası fırlatılır, önbelleğe yazılmaz (`getOrLoad`). */
  async snapshot(pageKey: PageKey): Promise<PageSnapshot> {
    return (await this.cache.getOrLoad(pageKey, () => this.load(pageKey))) ?? EMPTY_SNAPSHOT;
  }

  /** `catalog` = görüntüleyenin markette gördüğü ürünler; hedefi bu listede olmayan kart düşer. */
  async resolveForUser<T extends { id: string }>(
    pageKey: PageKey,
    ctx: ViewerContext,
    catalog: readonly T[],
  ): Promise<PageSectionView<T>[]> {
    const { sections, items } = await this.snapshot(pageKey);
    return resolveSections(sections, items, new Map(catalog.map((item) => [item.id, item])), ctx);
  }

  /** Olay kaydı için: yayındaki bölümlerin aktif kartları → bölüm id. Taslak/pasif/bilinmeyen kart yok. */
  async publishedItemSections(pageKey: PageKey): Promise<Map<string, string>> {
    const { sections, items } = await this.snapshot(pageKey);
    const published = new Set(sections.filter((s) => s.status === "published").map((s) => s.id));
    return new Map(
      items.filter((item) => item.is_active && published.has(item.section_id)).map((item) => [item.id, item.section_id]),
    );
  }

  invalidate(): void {
    this.cache.clear();
  }

  private async load(pageKey: PageKey): Promise<PageSnapshot> {
    const { data: sections, error } = await supabase
      .from("page_sections")
      .select(SECTION_COLUMNS)
      .eq("page_key", pageKey)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .limit(SECTION_LOAD_LIMIT);
    if (error) {
      console.error("[page-sections] bolumler okunamadi:", error.message);
      throw Errors.SERVER_ERROR();
    }
    const rows = (sections ?? []) as SectionRow[];
    if (rows.length === 0) return EMPTY_SNAPSHOT;

    // ≤ 50 uuid: `.in()` URL sınırının çok altında.
    const { data: items, error: itemsError } = await supabase
      .from("page_section_items")
      .select(ITEM_COLUMNS)
      .in("section_id", rows.map((s) => s.id))
      .order("sort_order", { ascending: true })
      .limit(ITEM_LOAD_LIMIT);
    if (itemsError) {
      console.error("[page-sections] kartlar okunamadi:", itemsError.message);
      throw Errors.SERVER_ERROR();
    }
    return { sections: rows, items: (items ?? []) as SectionItemRow[] };
  }
}

export const pageSectionsService = new PageSectionsService();
