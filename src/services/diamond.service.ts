import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";

export interface AddPurpleResult {
  /** Islemden sonraki toplam mor bakiye. */
  purple: number;
  /** Bu cagrinin gercekten yatirdigi miktar; duplicate dallarinda 0. */
  credited: number;
}

export class DiamondService {
  // 24h social-signup cooldown devre dışı.
  // Anti-fraud değeri minimaldi (kullanıcı yine de hesap aç + bekle ile bypass edebilir)
  // ama legitimate kullanıcının mor elmasını harcamasını engelliyordu (satın almadan sonra dahi).
  // Re-enable etmek istenirse: user.auth_provider !== 'email' && hoursSinceCreation < 24
  // && !hasActiveSub && !hasIap koşullarını yeniden ekle.
  private async checkSocialCooldown(_userId: string) {
    return;
  }

  async getBalance(userId: string) {
    const { data, error } = await supabase
      .from("users")
      .select("green_diamonds, purple_diamonds")
      .eq("id", userId)
      .single();

    if (error || !data) {
      throw Errors.USER_NOT_FOUND();
    }

    return { green: data.green_diamonds, purple: data.purple_diamonds };
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

  async spendPurple(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string,
  ) {
    // Check 24h cooldown for social signup users
    await this.checkSocialCooldown(userId);

    // Read current balance for early validation
    const { data: user, error: readErr } = await supabase
      .from("users")
      .select("purple_diamonds")
      .eq("id", userId)
      .single();

    if (readErr || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    if (user.purple_diamonds < amount) {
      throw Errors.INSUFFICIENT_DIAMONDS(amount, user.purple_diamonds);
    }

    // Atomic decrement — .gte() ensures balance hasn't dropped below amount since read
    const { data: updated, error: updateErr } = await supabase
      .from("users")
      .update({ purple_diamonds: user.purple_diamonds - amount })
      .eq("id", userId)
      .gte("purple_diamonds", amount)
      .select("purple_diamonds")
      .single();

    if (updateErr || !updated) {
      throw Errors.INSUFFICIENT_DIAMONDS(amount, user.purple_diamonds);
    }

    // Insert transaction log
    const { error: txErr } = await supabase
      .from("diamond_transactions")
      .insert({
        user_id: userId,
        type: "PURPLE",
        amount: -amount,
        reason,
        reference_id: referenceId ?? null,
      });

    if (txErr) {
      throw Errors.SERVER_ERROR();
    }

    return { purple: updated.purple_diamonds };
  }

  /**
   * `addPurple` sonucu.
   * - `purple`  : islemden SONRAKI toplam mor bakiye
   * - `credited`: BU cagrinin gercekten yatirdigi miktar (duplicate'te 0)
   *
   * Ikisi ayri: duplicate dallarinda bakiye degismez ama dogru bakiye donmeli.
   */
  async addPurple(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string,
  ): Promise<AddPurpleResult> {
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

    // NOT (2026-09-08): duplicate dalları artık `{ purple: <gerçek bakiye>,
    // credited: 0 }` dönüyor, eskiden `{ purple: 0 }` dönüyordu. Gerekçe API
    // SÖZLEŞMESİ DOĞRULUĞU: normal dalda bu alan "yeni toplam bakiye" demek, o
    // yüzden duplicate'te 0 dönmek sözleşmeye göre "bakiyen sıfır" iddiasıydı.
    // Bugünkü mobil istemci bu gövdeyi OKUMUYOR (`Future<void> purchase`), yani
    // sahada görünen bir semptom değildi — ama sözleşmenin yalan söylememesi
    // gerekiyor ve `credited` sayesinde "yatmadı" durumu artık ayırt edilebilir.
    //
    // ÖNCE KAYIT, SONRA BAKİYE — sıra kasıtlı.
    //
    // Yukarıdaki guard "önce oku sonra yaz" olduğu için yarışa açık: 2026-09-05'te
    // iki istek 0,5 sn arayla geldi ve guard'ı aştı (500 yerine 1000 mor elmas).
    // Son savunma `uniq_diamond_money_reference` kısmi benzersiz indeksi
    // (migration 047, SUBSCRIPTION_BONUS + IAP_PURCHASE kapsıyor). O indeks
    // ancak bu insert'te devreye girer; bakiyeyi önce artırsaydık kısıt
    // reddettiğinde bakiye şişmiş ama log yazılmamış olurdu — para yoktan var
    // olurdu. Bu yüzden insert bir "hak talebi" gibi önce yazılır.
    const { error: txErr } = await supabase
      .from("diamond_transactions")
      .insert({
        user_id: userId,
        type: "PURPLE",
        amount: +amount,
        reason,
        reference_id: referenceId ?? null,
      });

    if (txErr) {
      // 23505 = unique_violation → yarışı kaybettik, ödül zaten verilmiş.
      if (txErr.code === "23505") {
        console.log(`[Diamond] Duplicate reward blocked by DB: ${referenceId} for user ${userId}`);
        return { purple: (await this.getBalance(userId)).purple, credited: 0 };
      }
      throw Errors.SERVER_ERROR();
    }

    // Read current balance
    const { data: user, error: readErr } = await supabase
      .from("users")
      .select("purple_diamonds")
      .eq("id", userId)
      .single();

    if (readErr || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    // Increment without optimistic lock — safe for sequential calls in same request
    const { data: updated, error: updateErr } = await supabase
      .from("users")
      .update({ purple_diamonds: user.purple_diamonds + amount })
      .eq("id", userId)
      .select("purple_diamonds")
      .single();

    if (updateErr || !updated) {
      throw Errors.SERVER_ERROR();
    }

    return { purple: updated.purple_diamonds, credited: amount };
  }

  async earnGreen(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string,
  ) {
    // Read current balance
    const { data: user, error: readErr } = await supabase
      .from("users")
      .select("green_diamonds")
      .eq("id", userId)
      .single();

    if (readErr || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    // Atomic increment — optimistic lock ensures no concurrent modification
    const { data: updated, error: updateErr } = await supabase
      .from("users")
      .update({ green_diamonds: user.green_diamonds + amount })
      .eq("id", userId)
      .gte("green_diamonds", user.green_diamonds)
      .select("green_diamonds")
      .single();

    if (updateErr || !updated) {
      throw Errors.SERVER_ERROR();
    }

    // Insert transaction log
    const { error: txErr } = await supabase
      .from("diamond_transactions")
      .insert({
        user_id: userId,
        type: "GREEN",
        amount: +amount,
        reason,
        reference_id: referenceId ?? null,
      });

    if (txErr) {
      throw Errors.SERVER_ERROR();
    }

    return { green: updated.green_diamonds };
  }

  async spendGreen(
    userId: string,
    amount: number,
    reason: string,
    referenceId?: string,
  ) {
    // Check 24h cooldown for social signup users
    await this.checkSocialCooldown(userId);

    // Read current balance for early validation
    const { data: user, error: readErr } = await supabase
      .from("users")
      .select("green_diamonds")
      .eq("id", userId)
      .single();

    if (readErr || !user) {
      throw Errors.USER_NOT_FOUND();
    }

    if (user.green_diamonds < amount) {
      throw Errors.INSUFFICIENT_DIAMONDS(amount, user.green_diamonds);
    }

    // Atomic decrement — .gte() ensures balance hasn't dropped below amount since read
    const { data: updated, error: updateErr } = await supabase
      .from("users")
      .update({ green_diamonds: user.green_diamonds - amount })
      .eq("id", userId)
      .gte("green_diamonds", amount)
      .select("green_diamonds")
      .single();

    if (updateErr || !updated) {
      throw Errors.INSUFFICIENT_DIAMONDS(amount, user.green_diamonds);
    }

    // Insert transaction log
    const { error: txErr } = await supabase
      .from("diamond_transactions")
      .insert({
        user_id: userId,
        type: "GREEN",
        amount: -amount,
        reason,
        reference_id: referenceId ?? null,
      });

    if (txErr) {
      throw Errors.SERVER_ERROR();
    }

    return { green: updated.green_diamonds };
  }
}

export const diamondService = new DiamondService();
