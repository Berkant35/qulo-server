import type { Request, Response, NextFunction } from "express";
import { matchingService } from "../services/matching.service.js";
import type { SwipeInput, DiscoverQuery } from "../validators/match.validator.js";

export async function discoverHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { page } = req.query as unknown as DiscoverQuery;
    const data = await matchingService.discover(userId, page);
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
    const data = await matchingService.getMatches(userId);
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
