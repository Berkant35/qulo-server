import { supabase } from "../config/supabase.js";

export interface ChannelInput {
  key: string;
  label: Record<string, string>;
  emoji?: string;
  sort_order: number;
  is_active: boolean;
  is_freeform: boolean;
}

export class AcquisitionChannelService {
  async list() {
    const { data, error } = await supabase
      .from("acquisition_channels")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async getById(id: string) {
    const { data, error } = await supabase
      .from("acquisition_channels")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async create(input: ChannelInput, adminId: string) {
    const { data, error } = await supabase
      .from("acquisition_channels")
      .insert({ ...input, created_by: adminId })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, input: ChannelInput) {
    const { error } = await supabase
      .from("acquisition_channels")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }

  async toggleActive(id: string) {
    const cur = await this.getById(id);
    if (!cur) return;
    const { error } = await supabase
      .from("acquisition_channels")
      .update({ is_active: !cur.is_active, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }

  async softDelete(id: string) {
    const { error } = await supabase
      .from("acquisition_channels")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  }

  /** Kanal başına cevap sayısı + skip + toplam. 0'lı aktif kanallar da listelenir. */
  async getReport(from?: string, to?: string) {
    let q = supabase.from("user_acquisition").select("channel_key, skipped, created_at");
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data ?? [];

    const channels = await this.list();
    const counts = new Map<string, number>();
    let skipped = 0;
    for (const r of rows) {
      if (r.skipped) { skipped++; continue; }
      if (r.channel_key) counts.set(r.channel_key, (counts.get(r.channel_key) ?? 0) + 1);
    }
    const answered = rows.length - skipped;
    const byChannel = channels.map((c) => ({
      key: c.key,
      label: c.label,
      emoji: c.emoji,
      is_active: c.is_active,
      count: counts.get(c.key) ?? 0,
      pct: answered > 0 ? Math.round(((counts.get(c.key) ?? 0) / answered) * 1000) / 10 : 0,
    }));
    return { total: rows.length, answered, skipped, byChannel };
  }
}

export const acquisitionChannelService = new AcquisitionChannelService();
