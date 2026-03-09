import type { Request, Response, NextFunction } from "express";
import { exchangeService } from "../services/exchange.service.js";
import type { ConvertInput, BuyPowerInput } from "../validators/exchange.validator.js";

export async function convertHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { green_amount } = req.body as ConvertInput;
    const result = await exchangeService.convertGreenToPurple(userId, green_amount);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function buyPowerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const { power_name, diamond_type, quantity } = req.body as BuyPowerInput;
    const result = await exchangeService.buyPower(userId, power_name, diamond_type, quantity);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getInventoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const result = await exchangeService.getInventory(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getRatesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await exchangeService.getRates();
    res.json(result);
  } catch (err) {
    next(err);
  }
}
