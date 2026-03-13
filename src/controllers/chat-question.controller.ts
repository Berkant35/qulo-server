import type { Request, Response, NextFunction } from "express";
import { chatQuestionService } from "../services/chat-question.service.js";
import type { CreateChatQuestionInput, AnswerChatQuestionInput } from "../validators/chat-question.validator.js";

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
    const { selected_option } = req.body as AnswerChatQuestionInput;
    const data = await chatQuestionService.answerQuestion(questionId, userId, selected_option);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
