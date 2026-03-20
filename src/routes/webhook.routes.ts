import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { revenueCatWebhookHandler } from '../controllers/webhook.controller.js';
import { validate } from '../middleware/validate.js';
import { rcWebhookSchema } from '../validators/webhook.validator.js';

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.post(
  '/revenuecat',
  webhookLimiter,
  validate(rcWebhookSchema),
  revenueCatWebhookHandler
);

export default router;
