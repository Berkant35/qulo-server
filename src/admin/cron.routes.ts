import { Router, Request, Response } from "express";
import { getCronJobs, toggleCronJob } from "../cron/index.js";

const router = Router();

// GET /admin/crons — list all cron jobs
router.get("/", (_req: Request, res: Response) => {
  res.json({ data: getCronJobs() });
});

// POST /admin/crons/:name/toggle — start or stop a cron
router.post("/:name/toggle", (req: Request, res: Response) => {
  const name = req.params.name as string;
  const { action } = req.body as { action: "start" | "stop" };

  if (!action || !["start", "stop"].includes(action)) {
    return res.status(400).json({ error: "action must be 'start' or 'stop'" });
  }

  const success = toggleCronJob(name, action);
  if (!success) {
    return res.status(404).json({ error: `Cron job '${name}' not found` });
  }

  res.json({ data: getCronJobs() });
});

export default router;
