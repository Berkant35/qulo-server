import { Router } from 'express';
import { revenueCatWebhookHandler } from '../controllers/webhook.controller.js';
import { validate } from '../middleware/validate.js';
import { rcWebhookSchema } from '../validators/webhook.validator.js';

const router = Router();

router.post(
  '/revenuecat',
  validate(rcWebhookSchema),
  revenueCatWebhookHandler
);

export default router;
