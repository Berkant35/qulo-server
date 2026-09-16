import { Router, Request, Response } from "express";
import { getCronJobs, toggleCronJob } from "../cron/index.js";
import { superAdminOnly, csrfValidate } from "./admin.middleware.js";

const router = Router();

router.use(superAdminOnly);

// GET /admin/crons — is listesi + baslat/durdur paneli
router.get("/", (req: Request, res: Response) => {
  res.render("crons", {
    jobs: getCronJobs(),
    error: req.query.error,
    session: req.session,
    csrfToken: req.session.csrfToken,
  });
});

// POST /admin/crons/:name/toggle — surec ici baslat/durdur (deploy sonrasi sifirlanir)
router.post("/:name/toggle", csrfValidate, (req: Request, res: Response) => {
  const name = req.params.name as string;
  const { action } = req.body as { action?: string };

  if (action !== "start" && action !== "stop") {
    return res.redirect("/admin/crons?error=" + encodeURIComponent("action 'start' ya da 'stop' olmali"));
  }
  if (!toggleCronJob(name, action)) {
    return res.redirect("/admin/crons?error=" + encodeURIComponent(`Cron isi bulunamadi: ${name}`));
  }
  res.redirect("/admin/crons");
});

export default router;
