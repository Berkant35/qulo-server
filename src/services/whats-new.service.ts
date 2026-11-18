import { supabase } from "../config/supabase.js";
import { TtlCache } from "../utils/ttl-cache.js";
import type { WhatsNewInput } from "../validators/whats-new.validator.js";

/**
 * Aktif "Yenilikler" kayıtları (tüm sürümler, birkaç satır) bellekte tutulur: uygulama her açılışta
 * sorar, DB'ye gitmesin (supabase-cost-guard). Admin yazımı önbelleği anında temizler; SQL ile
 * yapılan değişiklik en geç bu süre sonunda görünür.
 */
export const WHATS_NEW_TTL_MS = 60_000;

const ADMIN_KOLONLARI = "id, app_version, platform, content, image_url, is_active, created_by, created_at, updated_at";

export type WhatsNewPlatform = "all" | "ios" | "android";
type LocaleEntry = { title: string; body: string; cta_label?: string };

export interface WhatsNewRow {
  id: string;
  app_version: string;
  platform: WhatsNewPlatform;
  content: Record<string, LocaleEntry>;
  image_url: string | null;
  is_active: boolean;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Mobil sözleşme: docs/whats-new-api.md */
export interface WhatsNewItem {
  id: string;
  version: string;
  title: string;
  body: string;
  ctaLabel: string | null;
  imageUrl: string | null;
}

/** Postgres unique_violation — aktif (sürüm, platform) çifti zaten var. */
export class WhatsNewConflictError extends Error {
  constructor() {
    super("Bu sürüm ve platform için zaten aktif bir kayıt var.");
  }
}

function pickEntry(content: WhatsNewRow["content"], locale: string): LocaleEntry | null {
  for (const l of [locale, "en"]) {
    const e = content?.[l];
    if (e && e.title && e.body) return e;
  }
  return null;
}

class WhatsNewService {
  private readonly onbellek = new TtlCache<"aktif", ReadonlyArray<Readonly<WhatsNewRow>>>(WHATS_NEW_TTL_MS);

  /** Okuma hatası fırlatılır, önbelleğe yazılmaz. Boş liste geçerli değerdir (önbelleklenir). */
  private async aktifKayitlar(): Promise<ReadonlyArray<Readonly<WhatsNewRow>>> {
    const satirlar = await this.onbellek.getOrLoad("aktif", async () => {
      const { data, error } = await supabase
        .from("whats_new")
        .select("id, app_version, platform, content, image_url, is_active")
        .eq("is_active", true)
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as WhatsNewRow[];
    });
    return satirlar ?? [];
  }

  /**
   * İstemci sürümüne TAM eşleşen aktif kayıt: önce platforma özel, yoksa 'all'. Yoksa null.
   * Okuma hatasında null (pop-up gösterilmez; mobil sessiz geçer) ve hata loglanır.
   */
  async getForClient(version: string, platform: "ios" | "android", locale: string): Promise<WhatsNewItem | null> {
    let kayitlar: ReadonlyArray<Readonly<WhatsNewRow>>;
    try {
      kayitlar = await this.aktifKayitlar();
    } catch (err) {
      console.error("[whats-new] okunamadi:", err instanceof Error ? err.message : err);
      return null;
    }
    const surumde = kayitlar.filter((r) => r.app_version === version);
    const kayit = surumde.find((r) => r.platform === platform) ?? surumde.find((r) => r.platform === "all");
    if (!kayit) return null;
    const entry = pickEntry(kayit.content, locale);
    if (!entry) return null;
    return {
      id: kayit.id,
      version: kayit.app_version,
      title: entry.title,
      body: entry.body,
      ctaLabel: entry.cta_label ? entry.cta_label : null,
      imageUrl: kayit.image_url,
    };
  }

  // ── Admin CRUD ──
  async list(page: number, limit = 20) {
    const from = (page - 1) * limit;
    const { data, count, error } = await supabase
      .from("whats_new")
      .select(ADMIN_KOLONLARI, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);
    if (error) throw new Error(error.message);
    return { items: (data ?? []) as WhatsNewRow[], total: count ?? 0 };
  }

  async getById(id: string): Promise<WhatsNewRow | null> {
    const { data, error } = await supabase.from("whats_new").select(ADMIN_KOLONLARI).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as WhatsNewRow | null) ?? null;
  }

  // Yazımlar hata dönse bile önbelleği temizler: yazımın gidip gitmediği belirsizse eski listeyi sunmak kötü.
  async create(input: WhatsNewInput, adminId: string) {
    const { error } = await supabase.from("whats_new").insert({ ...input, created_by: adminId });
    this.onbellek.clear();
    this.throwIfError(error);
  }

  async update(id: string, input: WhatsNewInput) {
    const { error } = await supabase
      .from("whats_new")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id);
    this.onbellek.clear();
    this.throwIfError(error);
  }

  async toggleActive(id: string) {
    const cur = await this.getById(id);
    if (!cur) return;
    const { error } = await supabase
      .from("whats_new")
      .update({ is_active: !cur.is_active, updated_at: new Date().toISOString() })
      .eq("id", id);
    this.onbellek.clear();
    this.throwIfError(error);
  }

  private throwIfError(error: { message: string; code?: string } | null) {
    if (!error) return;
    if (error.code === "23505") throw new WhatsNewConflictError();
    throw new Error(error.message);
  }
}

export const whatsNewService = new WhatsNewService();
