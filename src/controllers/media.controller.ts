import type { Request, Response, NextFunction } from "express";
import { mediaService } from "../services/media.service.js";
import type { RespondMediaRequestInput } from "../validators/media.validator.js";

export async function requestMediaHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const matchId = req.params.match_id as string;
    const data = await mediaService.requestMedia(matchId, userId);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function respondToMediaRequestHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const requestId = req.params.id as string;
    const { action } = req.body as RespondMediaRequestInput;
    const data = await mediaService.respondToRequest(requestId, userId, action);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function disableMediaHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const matchId = req.params.match_id as string;
    const data = await mediaService.disableMedia(matchId, userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getMediaStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const matchId = req.params.match_id as string;
    const data = await mediaService.getMediaStatus(matchId, userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
