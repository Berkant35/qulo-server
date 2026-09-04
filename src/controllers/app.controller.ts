import type { Request, Response, NextFunction } from "express";
import { appConfigService } from "../services/app-config.service.js";
import { economyConfigService } from "../services/economy-config.service.js";
import { localeFromRequestHeaders } from "../utils/locales.js";

export async function getAppConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const platform = (req.headers["x-app-platform"] as string) || "android";
    const locale = localeFromRequestHeaders(req.headers);
    const validPlatform = platform === "ios" ? "ios" : "android";
    const config = await appConfigService.getConfig(validPlatform, locale);
    res.json(config);
  } catch (err) {
    next(err);
  }
}

export async function getEconomyConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const config = await economyConfigService.getActiveConfig();
    res.json(config);
  } catch (err) {
    next(err);
  }
}
