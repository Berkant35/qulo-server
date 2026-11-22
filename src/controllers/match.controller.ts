import type { Request, Response, NextFunction } from "express";
import { matchingService } from "../services/matching.service.js";
import { localeFromRequestHeaders } from "../utils/locales.js";
import { mediaActiveFailClosed } from "./media-gate.js";
import type { SwipeInput, DiscoverQuery } from "../validators/match.validator.js";

export async function discoverHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { page } = req.query as unknown as DiscoverQuery;
    // Sesli/gorselli soru rozetleri (has_voice/has_image) yalniz kapi acikken; eski istemciye yanit birebir eski.
    const data = await matchingService.discover(userId, page, { active: await mediaActiveFailClosed(req, "discover") });
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function swipeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { target_id, action } = req.body as SwipeInput;
    const data = await matchingService.swipe(userId, target_id, action);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getMatchesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    // Header'siz eski mobil surum → LEGACY_CLIENT_LOCALE (tr): onizleme eskisi gibi kalir.
    const data = await matchingService.getMatches(userId, localeFromRequestHeaders(req.headers));
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function undoSwipeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const targetId = req.params.target_id as string;
    const data = await matchingService.undoSwipe(userId, targetId, { active: await mediaActiveFailClosed(req, "undo") });
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function unmatchHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const matchId = req.params.match_id as string;
    const data = await matchingService.unmatch(userId, matchId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
