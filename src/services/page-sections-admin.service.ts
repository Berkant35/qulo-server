import { randomUUID } from "crypto";
import { supabase } from "../config/supabase.js";
import { DEGISMEZ_DOSYA_CACHE_CONTROL } from "../constants/storage.js";
import { Errors } from "../utils/errors.js";
import { normalizeUploadedImage, NORMAL_GORSEL_MIME } from "../utils/image-normalize.js";
import {
  byOrder,
  ITEM_LOAD_LIMIT,
  SECTION_LIMITS,
  SECTION_LOAD_LIMIT,
  type PageKey,
  type SectionItemRow,
  type SectionRow,
  type SectionStatus,
  type SectionType,
} from "../utils/page-sections.js";
import type { BannerItemInput, FeaturedItemInput, SectionInput } from "../validators/page-sections.validator.js";
import type { RewardBrand } from "../validators/rewards.validator.js";
import { pageSectionsService } from "./page-sections.service.js";

const BUCKET = "assets";
const SECTION_COLUMNS =
  "id, page_key, section_type, heading, sort_order, status, countries, platforms, locales, autoplay_seconds, created_at, updated_at";
const ITEM_COLUMNS =
  "id, section_id, sort_order, is_active, countries, platforms, locales, image_url, content, action_type, action_catalog_item_id, action_route, catalog_item_id, created_at, updated_at";
const CATALOG_OPTION_COLUMNS = "id, brand_key, country_code, currency, face_value, is_active";
const CATALOG_OPTION_LIMIT = 200;

export type MoveDirection = "up" | "down";

export interface AdminSection extends SectionRow {
  created_at: string;
  updated_at: string | null;
}

type ItemRow = SectionItemRow & { created_at: string; updated_at: string | null };

export interface AdminSectionItem extends ItemRow {
  /** Hedef ürün pasif, silinmiş ya da yok → mobilde görünmez (backoffice rozeti, spec §6). */
  target_unavailable: boolean;
}

export interface AdminSectionSummary extends AdminSection {
  item_count: number;
  active_item_count: number;
  unavailable_count: number;
}

export interface CatalogOption {
  id: string;
  brand_key: RewardBrand;
  country_code: string;
  currency: string;
  face_value: number;
  is_active: boolean;
}

interface CatalogState {
  id: string;
  country_code: string;
  is_active: boolean;
  deleted_at: string | null;
}

type ItemPatch = Partial<Omit<SectionItemRow, "id" | "section_id" | "sort_order">>;

const itemLimit = (section: SectionRow): number =>
  section.section_type === "banner_carousel" ? SECTION_LIMITS.carouselItems : SECTION_LIMITS.featuredItems;
const targetOf = (item: SectionItemRow): string | null => item.catalog_item_id ?? item.action_catalog_item_id;
const nextOrder = (rows: { sort_order: number }[]): number =>
  rows.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
const targetingOf = (input: Pick<SectionInput, "countries" | "platforms" | "locales">) => ({
  countries: input.countries, platforms: input.platforms, locales: input.locales,
});

/**
 * Backoffice "Sayfa bölümleri" (spec 2026-09-28 §6). Yalnız süper admin çağırır (rewards.admin.routes).
 * Her başarılı yazım okuma önbelleğini (`pageSectionsService`) bu süreçte hemen düşürür. Sınırlar ve hedef
 * kuralları burada; DB CHECK'leri (071) tür–alan tutarlılığını ikinci kez kilitler.
 */
class PageSectionsAdminService {
  async listSections(pageKey: PageKey): Promise<AdminSectionSummary[]> {
    const sections = await this.loadSections(pageKey);
    const items = await this.loadItems(sections.map((s) => s.id));
    return sections.map((section) => {
      const own = items.filter((item) => item.section_id === section.id);
      return {
        ...section,
        item_count: own.length,
        active_item_count: own.filter((item) => item.is_active).length,
        unavailable_count: own.filter((item) => item.target_unavailable).length,
      };
    });
  }

  async getSection(id: string): Promise<{ section: AdminSection; items: AdminSectionItem[] } | null> {
    const section = await this.findSection(id);
    if (!section) return null;
    return { section, items: await this.loadItems([id]) };
  }

  /** Kart hedefi seçenekleri: silinmemiş ürünler (pasif dahil — rozetle görünür), bölüm ülkelerine süzülü. */
  async catalogOptions(countries: string[] | null): Promise<CatalogOption[]> {
    let query = supabase.from("reward_catalog_items").select(CATALOG_OPTION_COLUMNS).is("deleted_at", null);
    if (countries && countries.length > 0) query = query.in("country_code", countries);
    const { data, error } = await query
      .order("country_code", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("face_value", { ascending: true })
      .limit(CATALOG_OPTION_LIMIT);
    if (error) throw Errors.SERVER_ERROR();
    return ((data ?? []) as CatalogOption[]).map((option) => ({ ...option, face_value: Number(option.face_value) }));
  }

  async createSection(pageKey: PageKey, input: SectionInput, adminId: string): Promise<AdminSection> {
    const existing = await this.loadSections(pageKey);
    if (existing.length >= SECTION_LIMITS.sectionsPerPage) throw Errors.PAGE_SECTION_LIMIT(SECTION_LIMITS.sectionsPerPage);

    const { data, error } = await supabase
      .from("page_sections")
      .insert({
        page_key: pageKey,
        section_type: input.section_type,
        heading: input.heading,
        ...targetingOf(input),
        autoplay_seconds: input.autoplay_seconds,
        sort_order: nextOrder(existing),
        status: "draft",
        created_by: adminId,
      })
      .select(SECTION_COLUMNS)
      .single();
    if (error || !data) throw Errors.SERVER_ERROR();
    pageSectionsService.invalidate();
    return data as AdminSection;
  }

  /** Tür oluşturmada sabitlenir (kartlar türe bağlı): formdaki tür yok sayılır. */
  async updateSection(id: string, input: SectionInput): Promise<void> {
    await this.updateSectionRow(id, {
      heading: input.heading,
      ...targetingOf(input),
      autoplay_seconds: input.autoplay_seconds,
    });
  }

  async setSectionStatus(id: string, status: SectionStatus): Promise<void> {
    await this.updateSectionRow(id, { status });
  }

  /** Soft delete: kartlar ve olaylar kalır (istatistik geçmişi); bölüm hiçbir yerde görünmez. */
  async softDeleteSection(id: string): Promise<void> {
    await this.updateSectionRow(id, { deleted_at: new Date().toISOString(), status: "draft" });
  }

  async moveSection(id: string, direction: MoveDirection): Promise<void> {
    const section = await this.requireSection(id);
    await this.reorder("page_sections", await this.loadSections(section.page_key), id, direction);
  }

  async createBannerItem(sectionId: string, input: BannerItemInput, image: Buffer | null): Promise<void> {
    const section = await this.requireSection(sectionId, "banner_carousel");
    if (!image) throw Errors.PAGE_SECTION_IMAGE_REQUIRED();
    if (input.action_catalog_item_id) await this.assertTarget(section, input.action_catalog_item_id);
    if (input.is_active) await this.assertActiveRoom(section, null);
    // Kurallar geçtikten SONRA yüklenir: reddedilen form depoda artık dosya bırakmaz.
    const imageUrl = await this.uploadBanner(sectionId, image);
    await this.insertItem(section, {
      ...targetingOf(input),
      is_active: input.is_active,
      image_url: imageUrl,
      content: input.content,
      action_type: input.action_type,
      action_catalog_item_id: input.action_catalog_item_id,
      action_route: input.action_route,
      catalog_item_id: null,
    });
  }

  async updateBannerItem(sectionId: string, itemId: string, input: BannerItemInput, image: Buffer | null): Promise<void> {
    const section = await this.requireSection(sectionId, "banner_carousel");
    const item = await this.requireItem(sectionId, itemId);
    if (input.action_catalog_item_id) await this.assertTarget(section, input.action_catalog_item_id);
    if (input.is_active && !item.is_active) await this.assertActiveRoom(section, itemId);
    const imageUrl = image ? await this.uploadBanner(sectionId, image) : item.image_url;
    await this.updateItemRow(sectionId, itemId, {
      ...targetingOf(input),
      is_active: input.is_active,
      image_url: imageUrl,
      content: input.content,
      action_type: input.action_type,
      action_catalog_item_id: input.action_catalog_item_id,
      action_route: input.action_route,
    });
  }

  async createFeaturedItem(sectionId: string, input: FeaturedItemInput): Promise<void> {
    const section = await this.requireSection(sectionId, "featured_items");
    await this.assertTarget(section, input.catalog_item_id);
    if (input.is_active) await this.assertActiveRoom(section, null);
    await this.insertItem(section, {
      ...targetingOf(input),
      is_active: input.is_active,
      image_url: null,
      content: null,
      action_type: "none",
      action_catalog_item_id: null,
      action_route: null,
      catalog_item_id: input.catalog_item_id,
    });
  }

  async updateFeaturedItem(sectionId: string, itemId: string, input: FeaturedItemInput): Promise<void> {
    const section = await this.requireSection(sectionId, "featured_items");
    const item = await this.requireItem(sectionId, itemId);
    await this.assertTarget(section, input.catalog_item_id);
    if (input.is_active && !item.is_active) await this.assertActiveRoom(section, itemId);
    await this.updateItemRow(sectionId, itemId, {
      ...targetingOf(input),
      is_active: input.is_active,
      catalog_item_id: input.catalog_item_id,
    });
  }

  async setItemActive(sectionId: string, itemId: string, active: boolean): Promise<void> {
    const section = await this.requireSection(sectionId);
    const item = await this.requireItem(sectionId, itemId);
    if (active && !item.is_active) await this.assertActiveRoom(section, itemId);
    await this.updateItemRow(sectionId, itemId, { is_active: active });
  }

  async moveItem(sectionId: string, itemId: string, direction: MoveDirection): Promise<void> {
    await this.requireSection(sectionId);
    await this.reorder("page_section_items", await this.loadItems([sectionId]), itemId, direction);
  }

  /** Kalıcı silme: olayları cascade, talebin kaynak bağı NULL olur (migration 071). */
  async deleteItem(sectionId: string, itemId: string): Promise<void> {
    await this.requireSection(sectionId);
    await this.requireItem(sectionId, itemId);
    const { error } = await supabase.from("page_section_items").delete().eq("id", itemId).eq("section_id", sectionId);
    if (error) throw Errors.SERVER_ERROR();
    pageSectionsService.invalidate();
  }

  // ── yardımcılar ──────────────────────────────────────────────────────

  private async loadSections(pageKey: PageKey): Promise<AdminSection[]> {
    const { data, error } = await supabase
      .from("page_sections")
      .select(SECTION_COLUMNS)
      .eq("page_key", pageKey)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .limit(SECTION_LOAD_LIMIT);
    if (error) throw Errors.SERVER_ERROR();
    return (data ?? []) as AdminSection[];
  }

  private async findSection(id: string): Promise<AdminSection | null> {
    const { data, error } = await supabase
      .from("page_sections")
      .select(SECTION_COLUMNS)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    return (data as AdminSection | null) ?? null;
  }

  private async requireSection(id: string, type?: SectionType): Promise<AdminSection> {
    const section = await this.findSection(id);
    if (!section) throw Errors.PAGE_SECTION_NOT_FOUND();
    if (type && section.section_type !== type) throw Errors.VALIDATION_ERROR({ section_type: `expected ${type}` });
    return section;
  }

  private async requireItem(sectionId: string, itemId: string): Promise<ItemRow> {
    const { data, error } = await supabase
      .from("page_section_items")
      .select(ITEM_COLUMNS)
      .eq("id", itemId)
      .eq("section_id", sectionId)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.PAGE_SECTION_NOT_FOUND();
    return data as ItemRow;
  }

  private async loadItems(sectionIds: string[]): Promise<AdminSectionItem[]> {
    if (sectionIds.length === 0) return [];
    const { data, error } = await supabase
      .from("page_section_items")
      .select(ITEM_COLUMNS)
      .in("section_id", sectionIds)
      .order("sort_order", { ascending: true })
      .limit(ITEM_LOAD_LIMIT);
    if (error) throw Errors.SERVER_ERROR();
    const rows = (data ?? []) as ItemRow[];
    const states = await this.catalogStates(rows.map(targetOf).filter((id): id is string => id !== null));
    return rows.map((row) => {
      const target = targetOf(row);
      const state = target ? states.get(target) : undefined;
      const unavailable = target !== null && (!state || !state.is_active || Boolean(state.deleted_at));
      return { ...row, target_unavailable: unavailable };
    });
  }

  private async catalogStates(ids: string[]): Promise<Map<string, CatalogState>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const { data, error } = await supabase
      .from("reward_catalog_items")
      .select("id, country_code, is_active, deleted_at")
      .in("id", unique);
    if (error) throw Errors.SERVER_ERROR();
    return new Map(((data ?? []) as CatalogState[]).map((state) => [state.id, state]));
  }

  /** Hedef ürün var ve silinmemiş olmalı; bölüm ülke hedefliyse ürün o ülkelerden biri. Pasif ürün kabul. */
  private async assertTarget(section: SectionRow, catalogItemId: string): Promise<void> {
    const state = (await this.catalogStates([catalogItemId])).get(catalogItemId);
    if (!state || Boolean(state.deleted_at)) throw Errors.PAGE_SECTION_TARGET_INVALID();
    if (section.countries && section.countries.length > 0 && !section.countries.includes(state.country_code)) {
      throw Errors.PAGE_SECTION_TARGET_INVALID();
    }
  }

  /** Aktif kart sayısı satır taşımadan (`count`, head); sayı okunamazsa kapı kapalı kalır. */
  private async assertActiveRoom(section: SectionRow, excludeItemId: string | null): Promise<void> {
    let query = supabase
      .from("page_section_items")
      .select("id", { count: "exact", head: true })
      .eq("section_id", section.id)
      .eq("is_active", true);
    if (excludeItemId) query = query.neq("id", excludeItemId);
    const { count, error } = await query;
    if (error || count === null) throw Errors.SERVER_ERROR();
    const limit = itemLimit(section);
    if (count >= limit) throw Errors.PAGE_SECTION_ITEM_LIMIT(limit);
  }

  private async insertItem(section: SectionRow, row: ItemPatch): Promise<void> {
    // Yalnız en büyük sort_order (tek satır): sona eklemek için tüm kardeşleri çekmeye gerek yok.
    const { data: last, error: readError } = await supabase
      .from("page_section_items")
      .select("sort_order")
      .eq("section_id", section.id)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (readError) throw Errors.SERVER_ERROR();
    const { error } = await supabase
      .from("page_section_items")
      .insert({ ...row, section_id: section.id, sort_order: nextOrder((last ?? []) as { sort_order: number }[]) });
    if (error) throw Errors.SERVER_ERROR();
    pageSectionsService.invalidate();
  }

  private async updateSectionRow(id: string, patch: Record<string, unknown>): Promise<void> {
    const { data, error } = await supabase
      .from("page_sections")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.PAGE_SECTION_NOT_FOUND();
    pageSectionsService.invalidate();
  }

  private async updateItemRow(sectionId: string, itemId: string, patch: ItemPatch): Promise<void> {
    const { data, error } = await supabase
      .from("page_section_items")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("section_id", sectionId)
      .select("id")
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.PAGE_SECTION_NOT_FOUND();
    pageSectionsService.invalidate();
  }

  /**
   * Komşuyla yer değiştirir ve listeyi 0..n-1 numaralar (eski eşit sort_order'lar da düzelir); yalnız
   * değişen satırlar yazılır (≤ 12 satır, nadir admin işlemi). Uçtaki öğe o yöne gidemez: etkisiz.
   * Yazımlar tek tek (transaction yok): yarıda patlarsa yazılan kısım kalıcıdır, önbellek YİNE düşer.
   */
  private async reorder(
    table: "page_sections" | "page_section_items",
    rows: { id: string; sort_order: number }[],
    id: string,
    direction: MoveDirection,
  ): Promise<void> {
    const ordered = [...rows].sort(byOrder);
    const index = ordered.findIndex((row) => row.id === id);
    if (index < 0) throw Errors.PAGE_SECTION_NOT_FOUND();
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return;

    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved!);
    try {
      for (const [position, row] of ordered.entries()) {
        if (row.sort_order === position) continue;
        const { error } = await supabase
          .from(table)
          .update({ sort_order: position, updated_at: new Date().toISOString() })
          .eq("id", row.id);
        if (error) throw Errors.SERVER_ERROR();
      }
    } finally {
      pageSectionsService.invalidate();
    }
  }

  /** Metinsiz banner görseli: JPEG'e normalize (≤ 1440, q80), değişmez yol + 30 gün önbellek (CDN HIT). */
  private async uploadBanner(sectionId: string, image: Buffer): Promise<string> {
    const body = await normalizeUploadedImage(image, "page-sections");
    const path = `page-sections/${sectionId}/${randomUUID()}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
      contentType: NORMAL_GORSEL_MIME,
      cacheControl: DEGISMEZ_DOSYA_CACHE_CONTROL,
      upsert: false,
    });
    if (error) {
      console.error("[page-sections] banner yuklenemedi:", error.message);
      throw Errors.SERVER_ERROR();
    }
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
}

export const pageSectionsAdminService = new PageSectionsAdminService();
