import type { Request, Response, NextFunction } from "express";
import { chatService } from "../services/chat.service.js";
import type { SendMessageInput, ChatQuery, ReactionInput } from "../validators/chat.validator.js";

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
    const { content, is_image, audio_url, audio_duration_seconds } = req.body as SendMessageInput;
    const data = await chatService.sendMessage(userId, matchId, content, is_image, audio_url, audio_duration_seconds);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function deleteMessageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const matchId = req.params.match_id as string;
    const messageId = req.params.message_id as string;
    const data = await chatService.deleteMessage(userId, matchId, messageId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function addReactionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const matchId = req.params.match_id as string;
    const messageId = req.params.message_id as string;
    const { emoji } = req.body as ReactionInput;
    const data = await chatService.addReaction(userId, matchId, messageId, emoji);
    res.json(data);
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
