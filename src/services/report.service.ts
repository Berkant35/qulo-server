import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";

export class ReportService {
  async create(reporterId: string, reportedId: string, reason: string, category: string) {
    const { data, error } = await supabase
      .from("reports")
      .insert({
        reporter_id: reporterId,
        reported_id: reportedId,
        reason,
        category,
      })
      .select("id, reporter_id, reported_id, reason, category, created_at")
      .single();

    if (error) {
      throw Errors.SERVER_ERROR();
    }

    return data;
  }
}

export const reportService = new ReportService();
