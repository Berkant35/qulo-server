import type { Request, Response, NextFunction } from "express";
import { chatService } from "../services/chat.service.js";
import type { SendMessageInput, ChatQuery } from "../validators/chat.validator.js";

export async function getMessagesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const matchId = req.params.match_id as string;
    const { page, limit } = req.query as unknown as ChatQuery;
    const data = await chatService.getMessages(userId, matchId, page, limit);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function sendMessageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const matchId = req.params.match_id as string;
    const { content, is_image } = req.body as SendMessageInput;
    const data = await chatService.sendMessage(userId, matchId, content, is_image);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function markAsReadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const matchId = req.params.match_id as string;
    const data = await chatService.markAsRead(userId, matchId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
