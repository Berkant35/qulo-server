import type { Request, Response, NextFunction } from "express";
import { appConfigService } from "../services/app-config.service.js";
import { economyConfigService, toPublicEconomyConfig } from "../services/economy-config.service.js";
import { clientMetaFromHeaders } from "../utils/client-meta.js";
import { localeFromRequestHeaders } from "../utils/locales.js";
import { cityService } from "../services/city.service.js";
import type { CitySearchQuery } from "../validators/city.validator.js";

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
    // Herkese açık uç: rainbow bloğu (iç ekonomi kararları) yanıta girmez. `oracleAccuracy` config'in
    // içinde değil, üst seviyede: mobil auth öncesi güç demosunda Kâhin doğruluğunu buradan okur.
    const [{ version, config }, oracleAccuracy] = await Promise.all([
      economyConfigService.getActiveConfig(),
      economyConfigService.getOracleAccuracy(),
    ]);
    res.json({ version, config: toPublicEconomyConfig(config), oracleAccuracy });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/app/cities?country=TR&q=ist — konumsuz yedek yol (2.0.18). Desteklenen ulke kodlari her
 * yanitta (`countries`), sehirler filtreli (`cities`). Statik veri: cevap uzun sure onbelleklenebilir.
 */
export function getCitiesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { country, q, limit } = req.query as unknown as CitySearchQuery;
    res.set("Cache-Control", "public, max-age=86400");
    res.json({ countries: cityService.countries(), cities: cityService.search({ country, q, limit }) });
  } catch (err) {
    next(err);
  }
}
