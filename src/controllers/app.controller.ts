import type { Request, Response, NextFunction } from "express";
import { appConfigService } from "../services/app-config.service.js";
import { economyConfigService } from "../services/economy-config.service.js";
import { clientMetaFromHeaders } from "../utils/client-meta.js";
import { localeFromRequestHeaders } from "../utils/locales.js";

export async function getAppConfigHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // app-config yalnizca ios/android bilir: baslik yoksa (eski istemci), 'web' ya da
    // taninmayan bir degerse android — onceki varsayilan korunuyor.
    const platform = clientMetaFromHeaders(req.headers).platform === "ios" ? "ios" : "android";
    const locale = localeFromRequestHeaders(req.headers);
    const config = await appConfigService.getConfig(platform, locale);
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
