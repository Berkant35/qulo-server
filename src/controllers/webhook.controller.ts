import { Request, Response, NextFunction } from 'express';
import { webhookService } from '../services/webhook.service.js';
import { env } from '../config/env.js';
import { Errors } from '../utils/errors.js';

export const revenueCatWebhookHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!env.REVENUECAT_WEBHOOK_SECRET) {
      console.error('[webhook] REVENUECAT_WEBHOOK_SECRET is not set — rejecting request');
      throw Errors.INVALID_WEBHOOK_AUTH();
    }
    if (authHeader !== `Bearer ${env.REVENUECAT_WEBHOOK_SECRET}`) {
      throw Errors.INVALID_WEBHOOK_AUTH();
    }

    const { event } = req.body;
    await webhookService.handleRevenueCatEvent(event);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
