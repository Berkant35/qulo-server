import type { Request, Response, NextFunction } from "express";
import { passportService } from "../services/passport.service.js";
import type { ActivatePassportInput } from "../validators/passport.validator.js";

export async function activatePassportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { city, lat, lng } = req.body as ActivatePassportInput;
    const result = await passportService.activate(req.user!.userId, city, lat, lng);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function deactivatePassportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await passportService.deactivate(req.user!.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
