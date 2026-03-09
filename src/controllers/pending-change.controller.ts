import type { Request, Response, NextFunction } from 'express';
import { pendingChangeService } from '../services/pending-change.service.js';

export async function getPendingChangesHandler(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const userId = req.user!.userId;
    const data = await pendingChangeService.getPendingChanges(userId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

export async function queueChangeHandler(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const userId = req.user!.userId;
    const orderNum = parseInt(req.params.order as string, 10);
    const { change_type, payload } = req.body;
    const data = await pendingChangeService.queueChange(userId, orderNum, change_type, payload);
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
}

export async function cancelPendingChangeHandler(
  req: Request, res: Response, next: NextFunction
) {
  try {
    const userId = req.user!.userId;
    const changeId = req.params.changeId as string;
    const data = await pendingChangeService.cancelPendingChange(userId, changeId);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
