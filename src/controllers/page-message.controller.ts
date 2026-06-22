import type { Request, Response, NextFunction } from "express";
import { pageMessageService, type EventType } from "../services/page-message.service.js";

export async function getPageMessagesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const messages = await pageMessageService.getActiveForUser(req.user!.userId);
    res.json({ messages });
  } catch (err) { next(err); }
}

export async function postPageMessageEventHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await pageMessageService.recordEvent(req.user!.userId, req.params.id as string, (req.body.event as EventType));
    res.json({ ok: true });
  } catch (err) { next(err); }
}
