import { supabase } from "../config/supabase.js";
import { DELETION_REASON_CODES } from "../constants/deletion-reasons.js";
import { AppError } from "../utils/errors.js";

export interface DeletionReasonCount {
  reason_code: string;
  count: number;
}

export interface DeletionFeedbackRow {
  id: string;
  user_id: string | null;
  reason_code: string;
  reason_text: string | null;
  app_version: string | null;
  platform: string | null;
  locale: string | null;
  created_at: string;
}

class DeletionFeedbackService {
  private cutoffIso(days?: number): string | null {
    if (!days || days <= 0) return null;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  async getReport(days?: number): Promise<{ counts: DeletionReasonCount[]; total: number }> {
    const cutoff = this.cutoffIso(days);
    const counts = await Promise.all(
      DELETION_REASON_CODES.map(async (code) => {
        let query = supabase
          .from("account_deletion_feedback")
          .select("id", { count: "exact", head: true })
          .eq("reason_code", code);
        if (cutoff) query = query.gte("created_at", cutoff);
        const { count, error } = await query;
        if (error) throw new AppError(error.code ?? "DB_ERROR", 500, error.message);
        return { reason_code: code, count: count ?? 0 };
      }),
    );
    const total = counts.reduce((sum, c) => sum + c.count, 0);
    counts.sort((a, b) => b.count - a.count);
    return { counts, total };
  }

  async getRecent(
    page: number,
    pageSize: number,
    days?: number,
  ): Promise<{ rows: DeletionFeedbackRow[]; total: number }> {
    const cutoff = this.cutoffIso(days);
    const from = (page - 1) * pageSize;
    let query = supabase
      .from("account_deletion_feedback")
      .select("id, user_id, reason_code, reason_text, app_version, platform, locale, created_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (cutoff) query = query.gte("created_at", cutoff);
    const { data, count, error } = await query;
    if (error) throw new AppError(error.code ?? "DB_ERROR", 500, error.message);
    return { rows: (data as DeletionFeedbackRow[]) ?? [], total: count ?? 0 };
  }
}

export const deletionFeedbackService = new DeletionFeedbackService();
