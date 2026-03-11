import type { Request, Response, NextFunction } from "express";
import { questionService } from "../services/question.service.js";
import type { CreateQuestionInput, UpdateQuestionInput } from "../validators/question.validator.js";

export async function getMyQuestionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const data = await questionService.getMyQuestions(userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function createQuestionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const input = req.body as CreateQuestionInput;
    const data = await questionService.createQuestion(userId, input);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function updateQuestionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const orderNum = parseInt(req.params.order as string, 10);
    const input = req.body as UpdateQuestionInput;
    const data = await questionService.updateQuestion(userId, orderNum, input);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function deleteQuestionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const orderNum = parseInt(req.params.order as string, 10);
    await questionService.deleteQuestion(userId, orderNum);
    res.json({ message: "Question deleted" });
  } catch (err) {
    next(err);
  }
}

export async function getQuestionCountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const data = await questionService.getQuestionCount(userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getQuestionAnalyticsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const data = await questionService.getQuestionAnalytics(userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function getWeeklyReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const data = await questionService.getWeeklyReport(userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
