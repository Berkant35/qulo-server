import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { generalLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import {
  getSubscriptionStatusHandler,
  activateSubscriptionHandler,
  dailyStatsHandler,
} from '../controllers/subscription.controller.js';

const activateSchema = z.object({
  product_id: z.string().min(1),
  transaction_id: z.string().optional(),
});

const router = Router();

router.use(authMiddleware, generalLimiter);

router.get('/status', getSubscriptionStatusHandler);
router.get('/daily-stats', dailyStatsHandler);
router.post('/activate', validate(activateSchema), activateSubscriptionHandler);

export default router;
