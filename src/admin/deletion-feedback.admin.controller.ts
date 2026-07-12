import type { Request, Response } from "express";
import { deletionFeedbackService } from "../services/deletion-feedback.service.js";
import {
  REASON_CHURN_TYPES,
  type ChurnType,
  type DeletionReasonCode,
} from "../constants/deletion-reasons.js";
import { AppError } from "../utils/errors.js";

// Admin UI etiketleri (taksonomi + churn tipi: src/constants/deletion-reasons.ts)
const REASON_LABELS: Record<DeletionReasonCode, string> = {
  found_someone: "Found someone",
  few_matches: "Not enough matches",
  few_users_nearby: "Few users nearby",
  app_confusing: "App confusing / hard to use",
  technical_issues: "Technical issues",
  privacy_concerns: "Privacy concerns",
  too_expensive: "Too expensive",
  taking_a_break: "Taking a break",
  other: "Other (free text)",
  skipped: "Skipped",
};

const REASON_META: Record<string, { label: string; type: ChurnType }> = Object.fromEntries(
  (Object.keys(REASON_LABELS) as DeletionReasonCode[]).map((code) => [
    code,
    { label: REASON_LABELS[code], type: REASON_CHURN_TYPES[code] },
  ]),
);

const PAGE_SIZE = 20;
const VALID_DAYS = [7, 30, 90];

// PGRST205: PostgREST schema cache'te tablo yok; 42P01: Postgres undefined_table
const TABLE_MISSING_CODES = new Set(["PGRST205", "42P01"]);

class DeletionFeedbackAdminController {
  async page(req: Request, res: Response) {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const daysRaw = parseInt(req.query.days as string);
    const days = VALID_DAYS.includes(daysRaw) ? daysRaw : undefined; // undefined = tüm zamanlar

    try {
      const [report, recent] = await Promise.all([
        deletionFeedbackService.getReport(days),
        deletionFeedbackService.getRecent(page, PAGE_SIZE, days),
      ]);

      const byType: Record<ChurnType, number> = { positive: 0, negative: 0, neutral: 0 };
      for (const c of report.counts) {
        const type = REASON_META[c.reason_code]?.type ?? "neutral";
        byType[type] += c.count;
      }

      res.render("deletion-feedback", {
        report,
        byType,
        rows: recent.rows,
        total: recent.total,
        page,
        totalPages: Math.max(1, Math.ceil(recent.total / PAGE_SIZE)),
        days: days ?? 0,
        reasonMeta: REASON_META,
        tableMissing: false,
        session: req.session,
      });
    } catch (err: any) {
      // Migration henüz çalıştırılmadıysa sayfa yine de açılsın (kurulum talimatıyla)
      if (err instanceof AppError && TABLE_MISSING_CODES.has(err.code)) {
        return res.render("deletion-feedback", {
          report: { counts: [], total: 0 },
          byType: { positive: 0, negative: 0, neutral: 0 },
          rows: [],
          total: 0,
          page: 1,
          totalPages: 1,
          days: days ?? 0,
          reasonMeta: REASON_META,
          tableMissing: true,
          session: req.session,
        });
      }
      console.error("[Admin] deletion-feedback page failed:", err?.message ?? err);
      res.status(500).render("error", { message: "Failed to load deletion feedback", session: req.session });
    }
  }
}

export const deletionFeedbackAdminController = new DeletionFeedbackAdminController();
