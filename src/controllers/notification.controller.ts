import type { Request, Response, NextFunction } from "express";
import { notificationApiService } from "../services/notification-api.service.js";

export async function getNotificationsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const result = await notificationApiService.getNotifications(req.user!.userId, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getUnreadCountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const count = await notificationApiService.getUnreadCount(req.user!.userId);
    res.json({ unreadCount: count });
  } catch (err) {
    next(err);
  }
}

export async function markAsReadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const notificationId = req.params.id as string;
    await notificationApiService.markAsRead(req.user!.userId, notificationId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function markAllAsReadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await notificationApiService.markAllAsRead(req.user!.userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function trackClickHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const notificationId = req.params.id as string;
    await notificationApiService.trackClick(req.user!.userId, notificationId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
