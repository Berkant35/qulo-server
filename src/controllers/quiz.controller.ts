import type { Request, Response, NextFunction } from "express";
import { quizService } from "../services/quiz.service.js";
import type { StartQuizInput, AnswerQuizInput } from "../validators/quiz.validator.js";

export async function startQuizHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { target_id } = req.body as StartQuizInput;
    const data = await quizService.startSession(userId, target_id);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function getCurrentQuestionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const sessionId = req.params.session_id as string;
    const data = await quizService.getCurrentQuestion(sessionId, userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function answerQuestionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const sessionId = req.params.session_id as string;
    const { selected_answer, power_used, time_spent } = req.body as AnswerQuizInput;
    const data = await quizService.answerQuestion(sessionId, userId, selected_answer, power_used, time_spent);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getSessionResultHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const sessionId = req.params.session_id as string;
    const data = await quizService.getSessionResult(sessionId, userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getMatchQuizSummaryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const match_id = req.params.match_id as string;
    const data = await quizService.getMatchQuizSummary(match_id, userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
