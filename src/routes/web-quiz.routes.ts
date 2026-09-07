import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { webQuizLimiter, webQuizCreateLimiter, webQuizAttemptLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import {
  bankQuerySchema,
  createWebQuizSchema,
  attemptSchema,
  slugParamSchema,
  type BankQueryInput,
} from "../validators/web-quiz.validator.js";
import { webQuizService } from "../services/web-quiz.service.js";

/**
 * Herkese açık (auth yok): quloapp.com/q sayfaları buradan beslenir.
 * Kimlik olmadığı için koruma IP bazlı rate limit + 8kb gövde + şema doğrulama +
 * CSPRNG slug (32^8). Doğru cevaplar yalnızca attempt sonucunda döner.
 */
const router = Router();
router.use(webQuizLimiter);

router.get(
  "/bank",
  validate(bankQuerySchema, "query"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { locale } = req.query as unknown as BankQueryInput;
      res.json({ questions: await webQuizService.getBankSample(locale) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/",
  webQuizCreateLimiter,
  validate(createWebQuizSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(201).json(await webQuizService.create(req.body, req.ip ?? ""));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/:slug",
  validate(slugParamSchema, "params"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await webQuizService.getPublic(String(req.params.slug)));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/:slug/attempt",
  validate(slugParamSchema, "params"),
  webQuizAttemptLimiter,
  validate(attemptSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await webQuizService.attempt(String(req.params.slug), req.body.answers));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
