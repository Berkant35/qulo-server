import type { Request, Response, NextFunction } from "express";
import { appConfigService } from "../services/app-config.service.js";
import { economyConfigService } from "../services/economy-config.service.js";

export async function getAppConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const platform = (req.headers["x-app-platform"] as string) || "android";
    const locale = (req.headers["accept-language"] as string) || "tr";
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
