import { supabase } from "../config/supabase.js";
import type { ClientPlatform } from "../utils/client-meta.js";
import { Errors } from "../utils/errors.js";
import { toTargetPlatform, type PageKey } from "../utils/page-sections.js";
import type { SectionEventsInput } from "../validators/rewards.validator.js";
import { pageSectionsService } from "./page-sections.service.js";
import { rainbowAccessService, type RainbowAccessUser } from "./rainbow-access.service.js";

const EVENTS_PAGE: PageKey = "rewards_market";
const DAY_MS = 86_400_000;

export interface ItemStatsBreakdown {
  country: string | null;
  platform: string | null;
  impressions: number;
  clicks: number;
  redemptions: number;
}

export interface ItemStats {
  impressions: number;
  clicks: number;
  redemptions: number;
  /** Ülke + platform kırılımı, gösterime göre azalan. */
  breakdown: ItemStatsBreakdown[];
}

/**
 * Bölüm kartı ölçümü (spec 2026-09-28 §4.3, §5.4). Olaylar gün başı tekil: DB tekil indeksi
 * `(item_id, user_id, event, day)` + `ON CONFLICT DO NOTHING`. İstek başına 1 kullanıcı okuması + 1 toplu
 * yazım; kart → bölüm eşlemesi bölüm önbelleğinden. İstatistik SQL'de (JS geçmiş taraması YOK).
 */
class PageSectionEventsService {
  /** Yazılan (ya da zaten o gün var olan) satır sayısı. Yayında olmayan / bilinmeyen kart sessizce düşer. */
  async record(userId: string, events: SectionEventsInput["events"], platform?: ClientPlatform): Promise<number> {
    const published = await pageSectionsService.publishedItemSections(EVENTS_PAGE);
    const seen = new Set<string>();
    const accepted: { item_id: string; section_id: string; event: string }[] = [];
    for (const e of events) {
      const key = `${e.item_id}:${e.event}`;
      const sectionId = published.get(e.item_id);
      if (seen.has(key) || !sectionId) continue;
      seen.add(key);
      accepted.push({ item_id: e.item_id, section_id: sectionId, event: e.event });
    }
    if (accepted.length === 0) return 0;

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("country, is_test_admin, is_seed_profile, is_test_account")
      .eq("id", userId)
      .maybeSingle();
    if (userError) throw Errors.SERVER_ERROR();
    // Marketi göremeyen kullanıcının olayı ölçümü kirletmesin.
    if (!user || !(await rainbowAccessService.isEnabled(user as RainbowAccessUser, platform))) return 0;

    const country = (user as RainbowAccessUser).country?.toUpperCase() ?? null;
    const day = new Date().toISOString().slice(0, 10);
    const rows = accepted.map((e) => ({
      ...e, user_id: userId, country, platform: toTargetPlatform(platform), day,
    }));
    const { error } = await supabase
      .from("page_section_events")
      .upsert(rows, { onConflict: "item_id,user_id,event,day", ignoreDuplicates: true });
    if (error) {
      console.error("[page-section-events] olaylar yazilamadi:", error.message);
      throw Errors.SERVER_ERROR();
    }
    return rows.length;
  }

  /** Backoffice ölçüm tablosu: kart id → toplamlar + ülke/platform kırılımı (son `sinceDays` gün). */
  async stats(pageKey: PageKey, sinceDays: number): Promise<Map<string, ItemStats>> {
    const since = new Date(Date.now() - sinceDays * DAY_MS).toISOString();
    const { data, error } = await supabase.rpc("page_section_item_stats", { p_page_key: pageKey, p_since: since });
    if (error) {
      console.error("[page-section-events] istatistik okunamadi:", error.message);
      throw Errors.SERVER_ERROR();
    }

    const stats = new Map<string, ItemStats>();
    for (const row of (data ?? []) as ({ item_id: string } & ItemStatsBreakdown)[]) {
      const line: ItemStatsBreakdown = {
        country: row.country ?? null,
        platform: row.platform ?? null,
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        redemptions: Number(row.redemptions),
      };
      const total = stats.get(row.item_id) ?? { impressions: 0, clicks: 0, redemptions: 0, breakdown: [] };
      total.impressions += line.impressions;
      total.clicks += line.clicks;
      total.redemptions += line.redemptions;
      total.breakdown.push(line);
      stats.set(row.item_id, total);
    }
    for (const total of stats.values()) total.breakdown.sort((a, b) => b.impressions - a.impressions);
    return stats;
  }
}

export const pageSectionEventsService = new PageSectionEventsService();
