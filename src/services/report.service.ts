import { supabase } from "../config/supabase.js";
import { Errors } from "../utils/errors.js";

export class ReportService {
  /**
   * `reason` OPSIYONEL (2026-09-09). Istemci sebep yazilmadiginda alani hic
   * gondermiyordu ve sema onu zorunlu tuttugu icin sikayet 400 aliyordu —
   * ustelik cagri yerleri sonucu kontrol etmedigi icin kullanici hata bile
   * gormuyordu.
   *
   * `reports.reason` kolonu NOT NULL ve default'suz, o yuzden bos birakilamaz.
   * Migration yerine kategoriyi yaziyoruz: kategori zaten zorunlu ve sikayetin
   * ozunu tasiyor ("SPAM", "HARASSMENT"...), yani moderasyon panelinde bilgi
   * kaybi olmuyor. Bos string yazmak anlamsiz olurdu.
   */
  async create(reporterId: string, reportedId: string, reason: string | undefined, category: string, questionId?: string) {
    // Kendini sikayet etmek anlamsiz ve moderasyon kuyrugunu kirletir; DB'de
    // bunu engelleyen bir kisit yok (yalnizca pkey + iki FK).
    if (reporterId === reportedId) {
      throw Errors.VALIDATION_ERROR({ reported_id: "Cannot report yourself" });
    }

    // Soruya bagli sikayet: soru raporlanan kullanicinin olmali (baskasinin
    // sorusuna sikayet iliştirip yanlis kisiyi isaretlemek engellenir).
    if (questionId) {
      const { data: question, error: qError } = await supabase
        .from("questions")
        .select("id")
        .eq("id", questionId)
        .eq("user_id", reportedId)
        .maybeSingle();
      if (qError) throw Errors.SERVER_ERROR();
      if (!question) {
        throw Errors.VALIDATION_ERROR({ question_id: "Question does not belong to the reported user" });
      }
    }

    const { data, error } = await supabase
      .from("reports")
      .insert({
        reporter_id: reporterId,
        reported_id: reportedId,
        reason: reason ?? category,
        category,
        ...(questionId ? { question_id: questionId } : {}),
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
