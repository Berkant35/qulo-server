import { Request, Response, NextFunction } from 'express';
import { subscriptionService } from '../services/subscription.service.js';
import { revenueCatService } from '../services/revenuecat.service.js';
import { SUBSCRIPTION_PRODUCT_MAP } from '../types/index.js';

export const dailyStatsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const stats = await subscriptionService.getDailyStats(req.user!.userId);
    res.json(stats);
  } catch (error) {
    next(error);
  }
};

export const getSubscriptionStatusHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const status = await subscriptionService.getStatus(req.user!.userId);
    const limits = await subscriptionService.getLimits(status.plan);
    res.json({ subscription: status, limits });
  } catch (error) {
    next(error);
  }
};

export const activateSubscriptionHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user!.userId;
    const { product_id, transaction_id } = req.body;

    const plan = SUBSCRIPTION_PRODUCT_MAP[product_id];
    if (!plan) {
      res.status(400).json({ error: 'UNKNOWN_PRODUCT', message: `Unknown subscription product: ${product_id}` });
      return;
    }

    // Verify subscription with RevenueCat
    const verification = await revenueCatService.verifySubscription(userId, product_id);
    if (!verification.valid) {
      res.status(403).json({ error: 'INVALID_SUBSCRIPTION', message: verification.error });
      return;
    }

    const expiresAt = verification.expiresAt
      ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await subscriptionService.activateSubscription(
      userId,
      plan,
      `client_${userId}`,
      transaction_id || product_id,
      expiresAt,
    );

    const status = await subscriptionService.getStatus(userId);
    const limits = await subscriptionService.getLimits(status.plan);

    res.json({
      message: 'Subscription activated',
      subscription: status,
      limits,
    });
  } catch (error) {
    next(error);
  }
};
