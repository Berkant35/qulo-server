import type { Request, Response, NextFunction } from "express";
import { retentionService } from "../services/retention.service.js";
import type { RetentionReasonInput } from "../validators/user.validator.js";

// GET /users/me/retention/eligibility?reason_code=...
export async function getRetentionEligibilityHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { reason_code } = req.query as unknown as RetentionReasonInput;
    const result = await retentionService.checkEligibility(
      req.user!.userId,
      reason_code,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// POST /users/me/retention/claim  body: { reason_code }
export async function claimRetentionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { reason_code } = req.body as RetentionReasonInput;
    const result = await retentionService.claim(req.user!.userId, reason_code);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
