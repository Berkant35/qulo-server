import { supabase } from "../config/supabase.js";
import { segmentService, type SegmentUser } from "./segment.service.js";
import { TtlCache } from "../utils/ttl-cache.js";
import { Errors } from "../utils/errors.js";
import type { CreatePageMessageInput } from "../validators/page-message.validator.js";
import type { SegmentInput } from "../validators/segment.validator.js";

/**
 * Aktif mesaj listesi (herkes için aynı) her resume'da okunuyordu. Admin CRUD'u bu süreçte
 * önbelleği anında temizler; tarih aralığı önbellekten sonra, her çağrıda yeniden süzülür.
 */
export const AKTIF_MESAJ_TTL_MS = 60_000;

interface AktifMesajSatiri {
  id: string; page: string; display_type: string;
  content: Record<string, unknown>; image_url: string | null;
  action_url: string | null; frequency: string; priority: number;
  start_at: string | null; end_at: string | null; segment: unknown;
}

export interface PmEvent { event: string; created_at: string; }
export type EventType = "shown" | "clicked" | "dismissed";

export interface PublicPageMessage {
  id: string; page: string; display_type: string;
  content: Record<string, unknown>; image_url: string | null;
  action_url: string | null; frequency: string; priority: number;
}

const SELECT_USER = "gender, age, city, subscription_plan, last_seen_at, profile_completion, created_at, question_count, green_diamonds";

/**
 * Admin CRUD'unun döndürdüğü kolonlar — `select("*")` yerine (tablo 2026-09-28'de tam bu 16 kolon).
 * Tek sabit metin olmalı: `+` ile birleştirilirse supabase-js'in tip ayrıştırıcısı çözemez.
 */
const ADMIN_KOLONLARI = "id, title, page, display_type, content, image_url, action_url, frequency, priority, segment, start_at, end_at, is_active, created_by, created_at, updated_at";

/**
 * Kalıcı frekans kuralları. `Map`: düz nesnede `frequency = "constructor"` gibi bir değer
 * prototipten bir fonksiyon bulurdu; bilinmeyen değer her zaman gösterilmez.
 */
const FREKANS_KURALLARI = new Map<string, (events: PmEvent[]) => boolean>([
  ["every_visit", () => true],
  ["until_dismissed", (events) => !events.some((e) => e.event === "dismissed")],
  ["once", (events) => !events.some((e) => e.event === "shown")],
  ["daily", (events) => {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    return !events.some((e) => e.event === "shown" && Date.parse(e.created_at) >= startOfDay.getTime());
  }],
]);

// Saf: kalıcı frekans filtresi
export function passesFrequency(frequency: string, events: PmEvent[]): boolean {
  return FREKANS_KURALLARI.get(frequency)?.(events) ?? false;
}

class PageMessageService {
  private readonly aktifOnbellek = new TtlCache<"aktif", ReadonlyArray<Readonly<AktifMesajSatiri>>>(AKTIF_MESAJ_TTL_MS);

  /**
   * Paylaşılan liste — değiştirme. Okuma hatası fırlatılır ve önbelleğe YAZILMAZ; admin yazımı
   * sırasında süren okuma eski listeyi geri yazamaz (`getOrLoad`).
   */
  private async aktifMesajlar(): Promise<ReadonlyArray<Readonly<AktifMesajSatiri>>> {
    const satirlar = await this.aktifOnbellek.getOrLoad("aktif", async () => {
      const { data, error } = await supabase
        .from("page_messages")
        .select("id, page, display_type, content, image_url, action_url, frequency, priority, start_at, end_at, segment")
        .eq("is_active", true)
        .order("priority", { ascending: false });
      if (error) {
        console.error("[page-message] aktif liste okunamadi:", error.message);
        throw Errors.SERVER_ERROR();
      }
      return (data ?? []) as AktifMesajSatiri[];
    });
    return satirlar ?? [];
  }

  async getActiveForUser(userId: string): Promise<PublicPageMessage[]> {
    const nowIso = new Date().toISOString();
    // 1. Aktif + tarih aralığındaki mesajlar
    const active = (await this.aktifMesajlar()).filter((m) =>
      (!m.start_at || m.start_at <= nowIso) && (!m.end_at || m.end_at >= nowIso),
    );
    if (active.length === 0) return [];

    // 2. Kullanıcı segment alanları
    const { data: user, error: userError } = await supabase.from("users").select(SELECT_USER).eq("id", userId).single();
    if (userError) {
      console.error("[page-message] kullanici okunamadi:", userError.message);
      throw Errors.SERVER_ERROR();
    }
    const segUser = (user ?? {}) as SegmentUser;

    // 3. Bu kullanıcının ilgili mesajlara ait event'leri (frekans state)
    const ids = active.map((m) => m.id);
    // Okunamazsa frekans kontrolu "hic gosterilmemis" sanip kapatilmis mesaji yeniden gosterirdi.
    const { data: evs, error: evsError } = await supabase
      .from("page_message_events")
      .select("page_message_id, event, created_at")
      .eq("user_id", userId)
      .in("page_message_id", ids);
    if (evsError) {
      console.error("[page-message] olaylar okunamadi:", evsError.message);
      throw Errors.SERVER_ERROR();
    }
    const byMsg = new Map<string, PmEvent[]>();
    for (const e of evs ?? []) {
      const arr = byMsg.get(e.page_message_id) ?? [];
      arr.push({ event: e.event, created_at: e.created_at });
      byMsg.set(e.page_message_id, arr);
    }

    // 4. Segment + frekans filtrele, public alanlara indir
    return active
      .filter((m) => segmentService.matchesSegment(segUser, (m.segment ?? null) as SegmentInput | null))
      .filter((m) => passesFrequency(m.frequency, byMsg.get(m.id) ?? []))
      .map((m): PublicPageMessage => ({
        id: m.id, page: m.page, display_type: m.display_type,
        content: m.content, image_url: m.image_url,
        action_url: m.action_url, frequency: m.frequency, priority: m.priority,
      }));
  }

  async recordEvent(userId: string, messageId: string, event: EventType): Promise<void> {
    // Eligibility: mesaj aktif mi? (spec T4 — aktif olmayan mesaja event engeli)
    const { data: msg } = await supabase
      .from("page_messages").select("id").eq("id", messageId).eq("is_active", true).single();
    if (!msg) return;
    await supabase.from("page_message_events").insert({ page_message_id: messageId, user_id: userId, event });
  }

  // ── Admin CRUD ──
  async list(page: number, limit = 20) {
    const from = (page - 1) * limit;
    const { data, count, error } = await supabase
      .from("page_messages").select(ADMIN_KOLONLARI, { count: "exact" })
      .order("created_at", { ascending: false }).range(from, from + limit - 1);
    if (error) throw error;
    return { messages: data ?? [], total: count ?? 0 };
  }

  async getById(id: string) {
    const { data, error } = await supabase.from("page_messages").select(ADMIN_KOLONLARI).eq("id", id).single();
    if (error) throw error;
    return data;
  }

  // Yazımlar hata dönse bile önbelleği temizler: yazımın gidip gitmediği belirsizse eski listeyi
  // 60 sn sunmak, bir sonraki istekte DB'yi okumaktan kötü.
  async create(input: CreatePageMessageInput, adminId: string) {
    const { data, error } = await supabase.from("page_messages")
      .insert({ ...input, created_by: adminId }).select(ADMIN_KOLONLARI).single();
    this.aktifOnbellek.clear();
    if (error) throw error;
    return data;
  }

  async update(id: string, input: CreatePageMessageInput) {
    const { error } = await supabase.from("page_messages")
      .update({ ...input, updated_at: new Date().toISOString() }).eq("id", id);
    this.aktifOnbellek.clear();
    if (error) throw error;
  }

  async toggleActive(id: string) {
    const cur = await this.getById(id);
    const { error } = await supabase.from("page_messages")
      .update({ is_active: !cur.is_active, updated_at: new Date().toISOString() }).eq("id", id);
    this.aktifOnbellek.clear();
    if (error) throw error;
  }

  async remove(id: string) {
    const { error } = await supabase.from("page_messages").delete().eq("id", id);
    this.aktifOnbellek.clear();
    if (error) throw error;
  }

  // ── Analitik (on-the-fly aggregate) ──
  async getStats(messageId: string) {
    const { data, error } = await supabase
      .from("page_message_events").select("event, user_id").eq("page_message_id", messageId);
    if (error) throw error;
    const rows = data ?? [];
    const uniq = (ev: string) => new Set(rows.filter((r) => r.event === ev).map((r) => r.user_id)).size;
    const total = (ev: string) => rows.filter((r) => r.event === ev).length;
    const shown = uniq("shown");
    const clicked = uniq("clicked");
    return {
      shown_total: total("shown"), shown_unique: shown,
      clicked_unique: clicked, dismissed_unique: uniq("dismissed"),
      ctr: shown > 0 ? Math.round((clicked / shown) * 1000) / 10 : 0,
    };
  }
}

export const pageMessageService = new PageMessageService();
