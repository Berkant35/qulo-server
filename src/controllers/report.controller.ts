import type { Request, Response, NextFunction } from "express";
import { reportService } from "../services/report.service.js";
import type { CreateReportInput } from "../validators/report.validator.js";

export async function createReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { reported_id, reason, category } = req.body as CreateReportInput;
    const result = await reportService.create(req.user!.userId, reported_id, reason, category);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}
