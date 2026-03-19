import type { Request, Response, NextFunction } from "express";
import { blockService } from "../services/block.service.js";
import type { CreateBlockInput } from "../validators/block.validator.js";

export async function blockUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { blocked_id } = req.body as CreateBlockInput;
    const result = await blockService.block(req.user!.userId, blocked_id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function unblockUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const blockedId = req.params.userId as string;
    await blockService.unblock(req.user!.userId, blockedId);
    res.json({ message: "Unblocked" });
  } catch (err) {
    next(err);
  }
}
