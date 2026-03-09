import { Router } from "express";
import { authMiddleware } from "../middleware/auth.js";
import { generalLimiter } from "../middleware/rateLimit.js";
import {
  getNotificationsHandler,
  getUnreadCountHandler,
  markAsReadHandler,
  markAllAsReadHandler,
  trackClickHandler,
} from "../controllers/notification.controller.js";

const router = Router();

router.use(authMiddleware, generalLimiter);

router.get("/", getNotificationsHandler);
router.get("/unread-count", getUnreadCountHandler);
router.patch("/:id/read", markAsReadHandler);
router.post("/read-all", markAllAsReadHandler);
router.post("/:id/click", trackClickHandler);

export default router;
