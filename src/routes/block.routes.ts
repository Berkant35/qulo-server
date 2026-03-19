import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { createBlockSchema } from "../validators/block.validator.js";
import { blockUserHandler, unblockUserHandler } from "../controllers/block.controller.js";

const router = Router();
router.use(authMiddleware, generalLimiter);

router.post("/", validate(createBlockSchema), blockUserHandler);
router.delete("/:userId", unblockUserHandler);

export default router;
