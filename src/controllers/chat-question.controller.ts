import type { Request, Response, NextFunction } from "express";
import { chatQuestionService } from "../services/chat-question.service.js";
import type { CreateChatQuestionInput, AnswerChatQuestionInput, UsePowerInput, SaveDraftInput } from "../validators/chat-question.validator.js";
import type { PowerName } from "../types/index.js";

export async function createChatQuestionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const matchId = req.params.match_id as string;
    const body = req.body as CreateChatQuestionInput;
    const data = await chatQuestionService.createQuestion(matchId, userId, body);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function getChatQuestionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const questionId = req.params.id as string;
    const data = await chatQuestionService.getQuestion(questionId, userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function answerChatQuestionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const questionId = req.params.id as string;
    const { selected_option, power_used, time_spent } = req.body as AnswerChatQuestionInput;
    const data = await chatQuestionService.answerQuestion(questionId, userId, selected_option, power_used, time_spent);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function rescueHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const questionId = req.params.id as string;
    const data = await chatQuestionService.rescueQuestion(questionId, userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function usePowerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const questionId = req.params.id as string;
    const { power_name } = req.body as UsePowerInput;
    const data = await chatQuestionService.usePower(questionId, userId, power_name as PowerName);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function timeoutHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const questionId = req.params.id as string;
    const data = await chatQuestionService.handleTimeout(questionId, userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function saveDraftHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const data = await chatQuestionService.saveDraft(userId, req.body as SaveDraftInput);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function getDraftsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const data = await chatQuestionService.getDrafts(userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function deleteDraftHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const draftId = req.params.id as string;
    const data = await chatQuestionService.deleteDraft(userId, draftId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getHistoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const page = parseInt(req.query.page as string) || 1;
    const data = await chatQuestionService.getHistory(userId, page);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
