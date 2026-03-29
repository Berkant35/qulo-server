import type { Request, Response, NextFunction } from "express";
import { supportTicketService } from "../services/support-ticket.service.js";
import type { CreateTicketInput } from "../validators/support-ticket.validator.js";

export async function createTicketHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { subject, message, category } = req.body as CreateTicketInput;
    const result = await supportTicketService.create(
      req.user!.userId,
      subject,
      message,
      category,
    );
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function listTicketsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await supportTicketService.listByUser(req.user!.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getTicketHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await supportTicketService.getById(
      req.params.id as string,
      req.user!.userId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
