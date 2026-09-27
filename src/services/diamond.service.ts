import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";
import { paidPortion, type RewardSplit } from "../utils/math.js";

export interface AddPurpleResult {
  /** Islemden sonraki toplam mor bakiye. */
  purple: number;
  /** Bu cagrinin gercekten yatirdigi miktar; duplicate dallarinda 0. */
  credited: number;
}

export type LedgerType = "GREEN" | "PURPLE" | "RAINBOW";
type EarnedType = "GREEN" | "RAINBOW";
type BalanceRow = Record<string, number | null | undefined>;

const BALANCE_COLUMN: Record<LedgerType, "green_diamonds" | "purple_diamonds" | "rainbow_diamonds"> = {
  GREEN: "green_diamonds",
  PURPLE: "purple_diamonds",
  RAINBOW: "rainbow_diamonds",
};

/** CAS çakışmasında yeniden deneme sayısı. Gerçek yarış nadir; 3 deneme sonra SERVER_ERROR. */
const CAS_ATTEMPTS = 3;

export class DiamondService {
  async getBalance(userId: string) {
    const { data, error } = await supabase
      .from("users")
      .select("green_diamonds, purple_diamonds, rainbow_diamonds")
      .eq("id", userId)
      .single();

    if (error || !data) {
      throw Errors.USER_NOT_FOUND();
    }

    return {
      green: data.green_diamonds,
      purple: data.purple_diamonds,
      rainbow: data.rainbow_diamonds ?? 0,
    };
  }

  async getHistory(userId: string, page = 1, limit = 20) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data, error, count } = await supabase
      .from("diamond_transactions")
      .select("id, user_id, type, amount, reason, reference_id, created_at", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw Errors.SERVER_ERROR();
    }

    return {
      items: data ?? [],
      total: count ?? 0,
      page,
      limit,
    };
  }

  /**
   * Mor harcama — ÖNCE ÖDENMİŞ. `paidUsed` harcamanın gerçek parayla alınmış kısmı;
   * karşı tarafın ödülü bununla bölünür (spec 2026-09-27 §2.2).
   */
  async spendPurple(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string,
  ): Promise<{ purple: number; paidUsed: number }> {
    let paidUsed = 0;
    const { after } = await this.casUpdate(
      userId,
      ["purple_diamonds", "purple_paid"],
      (row) => {
        const purple = row.purple_diamonds ?? 0;
        const paid = row.purple_paid ?? 0;
        if (purple < amount) throw Errors.INSUFFICIENT_DIAMONDS(amount, purple);
        paidUsed = paidPortion(amount, paid);
        return { purple_diamonds: purple - amount, purple_paid: paid - paidUsed };
      },
    );

    await this.logTransaction(userId, "PURPLE", -amount, reason, referenceId, paidUsed);
    return { purple: after.purple_diamonds ?? 0, paidUsed };
  }

  /**
   * `paidAmount`: bu kredinin gerçek parayla alınmış kısmı (IAP = tamamı, abonelik bonusu =
   * tier payı, diğer tüm kaynaklar 0). `[0, amount]` aralığına sıkıştırılır.
   */
  async addPurple(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string,
    paidAmount = 0,
  ): Promise<AddPurpleResult> {
    const paid = Math.max(0, Math.min(paidAmount, amount));

    // Duplicate guard — prevent same reward being given twice
    if (referenceId) {
      const { data: existing } = await supabase
        .from("diamond_transactions")
        .select("id")
        .eq("user_id", userId)
        .eq("reference_id", referenceId)
        .maybeSingle();

      if (existing) {
        console.log(`[Diamond] Duplicate reward skipped: ${referenceId} for user ${userId}`);
        return { purple: (await this.getBalance(userId)).purple, credited: 0 };
      }
    }

    // ÖNCE KAYIT, SONRA BAKİYE — sıra kasıtlı (2026-09-05 çift kredi olayı): son savunma
    // `uniq_diamond_money_reference` kısmi benzersiz indeksi (047) ancak bu insert'te devreye
    // girer; bakiyeyi önce artırsaydık kısıt reddettiğinde para yoktan var olurdu.
    const { error: txErr } = await supabase
      .from("diamond_transactions")
      .insert({
        user_id: userId,
        type: "PURPLE",
        amount: +amount,
        reason,
        reference_id: referenceId ?? null,
        ...(paid > 0 ? { paid_amount: paid } : {}),
      });

    if (txErr) {
      // 23505 = unique_violation → yarışı kaybettik, ödül zaten verilmiş.
      if (txErr.code === "23505") {
        console.log(`[Diamond] Duplicate reward blocked by DB: ${referenceId} for user ${userId}`);
        return { purple: (await this.getBalance(userId)).purple, credited: 0 };
      }
      throw Errors.SERVER_ERROR();
    }

    const { after } = await this.casUpdate(
      userId,
      ["purple_diamonds", "purple_paid"],
      (row) => ({
        purple_diamonds: (row.purple_diamonds ?? 0) + amount,
        purple_paid: (row.purple_paid ?? 0) + paid,
      }),
    );

    return { purple: after.purple_diamonds ?? 0, credited: amount };
  }

  async earnGreen(userId: string, amount: number, reason: string, referenceId?: string) {
    return { green: await this.earn(userId, "GREEN", amount, reason, referenceId) };
  }

  async spendGreen(userId: string, amount: number, reason: string, referenceId?: string) {
    return { green: await this.spend(userId, "GREEN", amount, reason, referenceId) };
  }

  async earnRainbow(userId: string, amount: number, reason: string, referenceId?: string) {
    return { rainbow: await this.earn(userId, "RAINBOW", amount, reason, referenceId) };
  }

  async spendRainbow(userId: string, amount: number, reason: string, referenceId?: string) {
    return { rainbow: await this.spend(userId, "RAINBOW", amount, reason, referenceId) };
  }

  /** Bölünmüş güç ödülünü yazar: her pozitif pay için bir defter satırı (aynı reason/ref). */
  async creditReward(userId: string, split: RewardSplit, reason: string, referenceId?: string): Promise<void> {
    if (split.green > 0) await this.earnGreen(userId, split.green, reason, referenceId);
    if (split.rainbow > 0) await this.earnRainbow(userId, split.rainbow, reason, referenceId);
  }

  private async earn(userId: string, type: EarnedType, amount: number, reason: string, referenceId?: string) {
    const column = BALANCE_COLUMN[type];
    const { after } = await this.casUpdate(userId, [column], (row) => ({
      [column]: (row[column] ?? 0) + amount,
    }));
    await this.logTransaction(userId, type, +amount, reason, referenceId);
    return after[column] ?? 0;
  }

  private async spend(userId: string, type: EarnedType, amount: number, reason: string, referenceId?: string) {
    const column = BALANCE_COLUMN[type];
    const { after } = await this.casUpdate(userId, [column], (row) => {
      const current = row[column] ?? 0;
      if (current < amount) throw Errors.INSUFFICIENT_DIAMONDS(amount, current);
      return { [column]: current - amount };
    });
    await this.logTransaction(userId, type, -amount, reason, referenceId);
    return after[column] ?? 0;
  }

  /**
   * Tek satırlık bakiye değişikliği, gerçek compare-and-swap: okunan HER `columns` değeri
   * hâlâ aynıysa yazar, değilse yeniden okuyup dener. Eski `.gte(eski)` guard'ı iki eşzamanlı
   * artırımda birini kaybedebiliyordu; tek kolonu (ör. sadece `purple_diamonds`) koruyan bir
   * sonraki sürüm de ABA'ya açıktı — okunan `purple_paid` net değişmeden dursa bile araya giren
   * iki işlem (ödenmiş harcama + bedava kredi) bakiyeyi eski değerine geri getirebiliyor, guard
   * yine tutuyor ve `compute` bayat `purple_paid` ile hesaplanmış stale bir patch yazıyordu —
   * bedava mor "ödenmiş" etiketi kazanıyordu. Şimdi okunan HER kolon compare'e dahil: `columns`
   * içindeki her alan için `.eq(column, before[column])` zincirlenir, biri bile değişmişse guard
   * tutmaz. `compute` hata fırlatabilir (ör. INSUFFICIENT_DIAMONDS) — o zaman hiçbir şey yazılmaz.
   */
  private async casUpdate(
    userId: string,
    columns: readonly string[],
    compute: (row: BalanceRow) => BalanceRow,
  ): Promise<{ before: BalanceRow; after: BalanceRow }> {
    const selection = columns.join(", ");
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const { data: row, error: readErr } = await supabase
        .from("users")
        .select(selection)
        .eq("id", userId)
        .single();

      if (readErr || !row) {
        throw Errors.USER_NOT_FOUND();
      }

      const before = row as unknown as BalanceRow;
      const patch = compute(before);

      let query = supabase
        .from("users")
        .update(patch)
        .eq("id", userId);
      for (const column of columns) {
        query = query.eq(column, before[column]);
      }

      const { data: updated, error: updateErr } = await query
        .select(selection)
        .maybeSingle();

      if (updateErr) {
        throw Errors.SERVER_ERROR();
      }
      if (updated) {
        return { before, after: updated as unknown as BalanceRow };
      }
      // guard tutmadı: okuma ile yazma arasına başka bir istek girdi — yeniden oku.
    }
    throw Errors.SERVER_ERROR();
  }

  private async logTransaction(
    userId: string,
    type: LedgerType,
    amount: number,
    reason: string,
    referenceId?: string,
    paidAmount = 0,
  ): Promise<void> {
    const { error } = await supabase
      .from("diamond_transactions")
      .insert({
        user_id: userId,
        type,
        amount,
        reason,
        reference_id: referenceId ?? null,
        ...(paidAmount > 0 ? { paid_amount: paidAmount } : {}),
      });

    if (error) {
      throw Errors.SERVER_ERROR();
    }
  }
}

export const diamondService = new DiamondService();
