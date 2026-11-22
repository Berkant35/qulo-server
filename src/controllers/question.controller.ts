import type { Request, Response, NextFunction } from "express";
import { questionService } from "../services/question.service.js";
import { questionMediaService } from "../services/question-media.service.js";
import { Errors } from "../utils/errors.js";
import type { CreateQuestionInput, UpdateQuestionInput, ReorderQuestionsInput } from "../validators/question.validator.js";
import type { QuestionMediaParams, UploadVoiceBody } from "../validators/question-media.validator.js";

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

export async function reorderQuestionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { order } = req.body as ReorderQuestionsInput;
    const data = await questionService.reorderByIds(userId, order);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/** Multipart `file` alani zorunlu; tur/boyut multer'da, icerik ve sure serviste dogrulanir. */
function requireFile(req: Request): Express.Multer.File {
  if (!req.file) throw Errors.VALIDATION_ERROR({ file: "required" });
  return req.file;
}

export async function uploadQuestionVoiceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const file = requireFile(req);
    const orderNum = Number(req.params.order);
    const { duration_ms } = req.body as UploadVoiceBody;
    const data = await questionMediaService.uploadVoice(req.user!.userId, orderNum, file.buffer, file.mimetype, duration_ms);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function uploadQuestionImageHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const file = requireFile(req);
    const orderNum = Number(req.params.order);
    const data = await questionMediaService.uploadImage(req.user!.userId, orderNum, file.buffer, file.mimetype);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function deleteQuestionMediaHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { order, kind } = req.params as unknown as QuestionMediaParams;
    await questionMediaService.removeMedia(req.user!.userId, Number(order), kind);
    res.json({ message: "Question media deleted" });
  } catch (err) {
    next(err);
  }
}
