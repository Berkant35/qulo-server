import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { createTicketSchema } from "../validators/support-ticket.validator.js";
import {
  createTicketHandler,
  listTicketsHandler,
  getTicketHandler,
} from "../controllers/support-ticket.controller.js";

const router = Router();

router.use(authMiddleware, generalLimiter);

router.post("/", validate(createTicketSchema), createTicketHandler);
router.get("/", listTicketsHandler);
router.get("/:id", getTicketHandler);

export default router;
