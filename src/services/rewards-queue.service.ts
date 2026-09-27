import { supabase } from "../config/supabase.js";
import type { Page } from "../types/pagination.js";
import { Errors } from "../utils/errors.js";
import { fetchAll } from "../utils/fetch-all.js";
import {
  CAP_STATUSES,
  deliveryHost,
  maskDeliveryCode,
  monthStartUtc,
  redemptionReference,
  REWARD_REFUND_REASON,
} from "../utils/rewards.js";
import type {
  AdminRedemptionsQuery,
  FulfillInput,
  RedemptionStatus,
  RewardBrand,
} from "../validators/rewards.validator.js";
import { diamondService } from "./diamond.service.js";

const QUEUE_COLUMNS =
  "id, user_id, status, brand_key, country_code, currency, face_value, rainbow_price, platform, is_test, created_at, decided_at, reject_reason, admin_note, delivery_code, delivery_url";
export const QUEUE_PAGE_SIZE = 30;
/** E-posta araması en fazla bu kadar kullanıcıya daralır: sonuç `.in()` ile URL'ye yazılır. */
const USER_SEARCH_LIMIT = 50;
/**
 * Sayfadaki (≤30) kullanıcının bu ayki talepleri; tavan 150 iken kullanıcı başına birkaç satır.
 * PostgREST max-rows (1000) altında: sınır savunmadır, sessiz kırpma değil.
 */
const MONTH_TOTALS_LIMIT = 1000;

export interface QueueUser {
  id: string;
  email: string | null;
  name: string | null;
  country: string | null;
  rainbow_flagged_at: string | null;
  is_deleted: boolean;
}

export interface QueueRow {
  id: string;
  status: RedemptionStatus;
  brand_key: RewardBrand;
  country_code: string;
  currency: string;
  face_value: number;
  rainbow_price: number;
  platform: string | null;
  is_test: boolean;
  created_at: string;
  decided_at: string | null;
  reject_reason: string | null;
  admin_note: string | null;
  /** Teslim kodu nakit değerinde: backoffice'e asla ham gitmez. */
  masked_code: string;
  /** Teslim linki de taşıyıcı kimlik bilgisi (kod gibi): yalnız host gider, tam link asla. */
  delivery_host: string | null;
  /** null = hesap kalıcı silinmiş (069: ON DELETE SET NULL). */
  user: QueueUser | null;
  /** Kullanıcının bu takvim ayındaki (UTC) PENDING + FULFILLED toplamı. */
  user_month_total: number;
}

export interface RewardsSummary {
  pending: number;
  fulfilledThisMonth: number;
  rainbowFulfilledThisMonth: number;
  /** Tüm kullanıcılardaki rainbow (market dışında arka planda biriken dahil). */
  rainbowInCirculation: number;
  estimatedLiabilityUsd: number;
  flaggedUsers: number;
}

interface QueueDbRow extends Omit<QueueRow, "masked_code" | "delivery_host" | "user" | "user_month_total"> {
  user_id: string | null;
  delivery_code: string | null;
  delivery_url: string | null;
}

function toQueueRow(row: QueueDbRow, users: Map<string, QueueUser>, totals: Map<string, number>): QueueRow {
  const { user_id, delivery_code, delivery_url, ...rest } = row;
  return {
    ...rest,
    face_value: Number(row.face_value),
    masked_code: maskDeliveryCode(delivery_code),
    delivery_host: deliveryHost(delivery_url),
    user: user_id ? users.get(user_id) ?? null : null,
    user_month_total: user_id ? totals.get(user_id) ?? 0 : 0,
  };
}

/**
 * Backoffice "Rainbow Market" talep kuyruğu (spec §6): liste, teslim, ret + iade, özet, iade uyarısı.
 * Yalnız süper admin çağırır (rewards.admin.routes; uyarı temizleme admin kullanıcı detayından).
 */
export class RewardsQueueService {
  /** Talep kuyruğu. Bekleyenler kuyruk sırasıyla (en eski önce), sonuçlananlar en yeni önce. */
  async listRedemptions(filter: AdminRedemptionsQuery): Promise<Page<QueueRow>> {
    const empty: Page<QueueRow> = { items: [], total: 0, page: filter.page, pageSize: QUEUE_PAGE_SIZE };

    let userFilter: string[] | null = null;
    if (filter.q) {
      userFilter = await this.searchUserIds(filter.q);
      if (userFilter.length === 0) return empty;
    }

    const from = (filter.page - 1) * QUEUE_PAGE_SIZE;
    let query = supabase.from("reward_redemptions").select(QUEUE_COLUMNS, { count: "exact" });
    if (filter.status !== "ALL") query = query.eq("status", filter.status);
    if (filter.country) query = query.eq("country_code", filter.country);
    if (userFilter) query = query.in("user_id", userFilter);

    // `id` eşitlik bozucu: aynı anda açılan talepler sayfa sınırında kaymasın/tekrarlanmasın.
    const { data, error, count } = await query
      .order("created_at", { ascending: filter.status === "PENDING" })
      .order("id", { ascending: true })
      .range(from, from + QUEUE_PAGE_SIZE - 1);
    if (error) throw Errors.SERVER_ERROR();

    const rows = (data ?? []) as QueueDbRow[];
    const userIds = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => id !== null))];
    const [users, totals] = await Promise.all([this.loadQueueUsers(userIds), this.monthTotals(userIds)]);

    return {
      items: rows.map((r) => toQueueRow(r, users, totals)),
      total: count ?? 0,
      page: filter.page,
      pageSize: QUEUE_PAGE_SIZE,
    };
  }

  /** PENDING → FULFILLED, durum üzerinde CAS: iki admin aynı talebi iki kez sonuçlandıramaz. */
  async fulfill(id: string, input: FulfillInput, adminId: string): Promise<void> {
    const state = await this.loadPendingState(id);
    // Hesap kalıcı silinmiş: kodu görecek kimse yok — yalnız reddedilebilir (tedarikçiye boşa ödeme yok).
    if (!state.user_id) throw Errors.REWARD_NOT_ELIGIBLE();

    const { data, error } = await supabase
      .from("reward_redemptions")
      .update({
        status: "FULFILLED",
        delivery_code: input.delivery_code ?? null,
        delivery_url: input.delivery_url ?? null,
        admin_note: input.admin_note ?? null,
        decided_at: new Date().toISOString(),
        decided_by: adminId,
      })
      .eq("id", id)
      .eq("status", "PENDING")
      .select("id")
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.REWARD_ALREADY_DECIDED();
  }

  /**
   * Ret + iade. Durum CAS'la PENDING → REJECTED çevrilir; yalnız kazanan iade yazar (çift iade yok).
   * İade yazılamazsa talep REJECTED KALIR ve REWARD_REFUND_FAILED döner: geri PENDING'e almak,
   * bakiye yazılıp defter satırı düştüğü durumda ikinci denemede ÇİFT iade ederdi. Eksik iade görünür
   * ve elle düzeltilir (kullanıcı detayından bakiye); fazla iade sessiz para kaybıdır.
   */
  async reject(id: string, reason: string, adminId: string): Promise<void> {
    await this.loadPendingState(id);

    const { data, error } = await supabase
      .from("reward_redemptions")
      .update({
        status: "REJECTED",
        reject_reason: reason,
        decided_at: new Date().toISOString(),
        decided_by: adminId,
      })
      .eq("id", id)
      .eq("status", "PENDING")
      .select("id, user_id, rainbow_price")
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.REWARD_ALREADY_DECIDED();

    const decided = data as { id: string; user_id: string | null; rainbow_price: number };
    if (!decided.user_id) return; // hesap kalıcı silinmiş: iade edilecek bakiye yok

    try {
      await diamondService.earnRainbow(decided.user_id, decided.rainbow_price, REWARD_REFUND_REASON, redemptionReference(id));
    } catch (err) {
      // Hata "hiç yazılmadı" mı yoksa "bakiye yazıldı, defter satırı düşmedi" mi ayırt edilemiyor
      // (earnRainbow önce CAS bakiye, sonra defter yazıyor) — elle düzeltme için en iyi çaba teşhis.
      const [currentRainbow, refundLedgerRow] = await Promise.all([
        this.currentRainbowBestEffort(decided.user_id),
        this.refundLedgerRowExistsBestEffort(id),
      ]);
      console.error("[rewards-admin] CRITICAL: redemption rejected but refund failed", {
        id, userId: decided.user_id, amount: decided.rainbow_price, err, currentRainbow, refundLedgerRow,
      });
      throw Errors.REWARD_REFUND_FAILED();
    }
  }

  /**
   * Backoffice ana sayfası özeti. Kayıt sayısı 1000'i (PostgREST varsayılan max-rows) aşabilir → `fetchAll`.
   * Gerçek kullanıcıyı ölçer: test admin talepleri (`is_test`) ve seed/test hesaplarının rainbow'u
   * (erişimleri zaten kapalı, harcayamaz) sayılara girmez.
   */
  async getSummary(usdPerRainbow: number): Promise<RewardsSummary> {
    const monthStart = monthStartUtc(new Date());
    const [pending, flagged] = await Promise.all([
      supabase
        .from("reward_redemptions")
        .select("id", { count: "exact" })
        .eq("status", "PENDING")
        .eq("is_test", false)
        .limit(1),
      supabase.from("users").select("id", { count: "exact" }).not("rainbow_flagged_at", "is", null).limit(1),
    ]);
    if (pending.error || flagged.error) throw Errors.SERVER_ERROR();

    let fulfilledRows: { rainbow_price: number }[];
    let holderRows: { rainbow_diamonds: number }[];
    try {
      [fulfilledRows, holderRows] = await Promise.all([
        fetchAll<{ rainbow_price: number }>((from, to) =>
          supabase
            .from("reward_redemptions")
            .select("rainbow_price")
            .eq("status", "FULFILLED")
            .eq("is_test", false)
            .gte("decided_at", monthStart)
            .order("id")
            .range(from, to),
        ),
        fetchAll<{ rainbow_diamonds: number }>((from, to) =>
          supabase
            .from("users")
            .select("rainbow_diamonds")
            .gt("rainbow_diamonds", 0)
            .not("is_seed_profile", "is", true)
            .not("is_test_account", "is", true)
            .order("id")
            .range(from, to),
        ),
      ]);
    } catch {
      throw Errors.SERVER_ERROR();
    }

    const circulation = holderRows.reduce((sum, u) => sum + u.rainbow_diamonds, 0);

    return {
      pending: pending.count ?? 0,
      fulfilledThisMonth: fulfilledRows.length,
      rainbowFulfilledThisMonth: fulfilledRows.reduce((sum, r) => sum + r.rainbow_price, 0),
      rainbowInCirculation: circulation,
      estimatedLiabilityUsd: Math.round(circulation * usdPerRainbow * 100) / 100,
      flaggedUsers: flagged.count ?? 0,
    };
  }

  /** Yanlış alarm (ör. iade geri çevrildi): kullanıcının rainbow iade uyarısını kaldırır. */
  async clearRainbowFlag(userId: string): Promise<void> {
    const { data, error } = await supabase
      .from("users")
      .update({ rainbow_flagged_at: null })
      .eq("id", userId)
      .select("id")
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.USER_NOT_FOUND();
  }

  private async loadPendingState(id: string): Promise<{ status: RedemptionStatus; user_id: string | null }> {
    const { data, error } = await supabase
      .from("reward_redemptions")
      .select("status, user_id")
      .eq("id", id)
      .maybeSingle();
    if (error) throw Errors.SERVER_ERROR();
    if (!data) throw Errors.REWARD_REDEMPTION_NOT_FOUND();
    const state = data as { status: RedemptionStatus; user_id: string | null };
    if (state.status !== "PENDING") throw Errors.REWARD_ALREADY_DECIDED();
    return state;
  }

  private async searchUserIds(q: string): Promise<string[]> {
    // PostgreSQL LIKE joker karakterleri (`%`, `_`) girdiden SİLİNMEZ, kaçışlanır — yoksa
    // "ali_veli@..." gibi gerçek karakter içeren e-postalar aranamaz olurdu. `\` da önce
    // kaçışlanır (aksi halde girdideki bir `\` az sonra eklenen kaçış işaretiyle karışır).
    // `*`: PostgREST bunu istekte `%` takma adı olarak çözer, kaçış geçerli olmaz — kaldırılır.
    const needle = q
      .replace(/\\/g, "\\\\")
      .replace(/%/g, "\\%")
      .replace(/_/g, "\\_")
      .replace(/\*/g, "");
    if (!needle) return [];
    const { data, error } = await supabase
      .from("users")
      .select("id")
      .ilike("email", `%${needle}%`)
      .limit(USER_SEARCH_LIMIT);
    if (error) throw Errors.SERVER_ERROR();
    return ((data ?? []) as { id: string }[]).map((u) => u.id);
  }

  /** En iyi çaba: `reject`'in CRITICAL logu için — asıl hatayı (REWARD_REFUND_FAILED) gölgelemesin. */
  private async currentRainbowBestEffort(userId: string): Promise<number | null> {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("rainbow_diamonds")
        .eq("id", userId)
        .maybeSingle();
      if (error || !data) return null;
      return (data as { rainbow_diamonds: number }).rainbow_diamonds;
    } catch {
      return null;
    }
  }

  /** En iyi çaba: iade defter satırı gerçekten düşmüş mü (bakiye mi yoksa defter mi eksik kaldı). */
  private async refundLedgerRowExistsBestEffort(redemptionId: string): Promise<boolean | null> {
    try {
      const { data, error } = await supabase
        .from("diamond_transactions")
        .select("id")
        .eq("reference_id", redemptionReference(redemptionId))
        .eq("reason", REWARD_REFUND_REASON)
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data !== null;
    } catch {
      return null;
    }
  }

  private async loadQueueUsers(ids: string[]): Promise<Map<string, QueueUser>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await supabase
      .from("users")
      .select("id, email, name, country, rainbow_flagged_at, is_deleted")
      .in("id", ids);
    if (error) throw Errors.SERVER_ERROR();
    return new Map(
      ((data ?? []) as QueueUser[]).map((u) => [
        u.id,
        { ...u, rainbow_flagged_at: u.rainbow_flagged_at ?? null, is_deleted: u.is_deleted === true },
      ]),
    );
  }

  private async monthTotals(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await supabase
      .from("reward_redemptions")
      .select("user_id, rainbow_price")
      .in("user_id", ids)
      .in("status", [...CAP_STATUSES])
      .gte("created_at", monthStartUtc(new Date()))
      .limit(MONTH_TOTALS_LIMIT);
    if (error) throw Errors.SERVER_ERROR();

    const totals = new Map<string, number>();
    for (const r of (data ?? []) as { user_id: string; rainbow_price: number }[]) {
      totals.set(r.user_id, (totals.get(r.user_id) ?? 0) + r.rainbow_price);
    }
    return totals;
  }
}

export const rewardsQueueService = new RewardsQueueService();
