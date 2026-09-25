import type { Request, Response } from "express";
import { z } from "zod";
import { campaignService, type RecurringState } from "../services/campaign.service.js";
import { segmentSchema, isRecurring } from "../validators/campaign.validator.js";
import { parseCampaignForm, formatZodIssues } from "./campaign-form.js";

const PAGE_SIZE = 20;
const idSchema = z.string().uuid();

/** Kampanya backoffice'i: yalniz req parse + render/redirect. Is mantigi campaign.service'te. */
class CampaignAdminController {
  async list(req: Request, res: Response) {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const { campaigns, total } = await campaignService.getCampaigns(page, PAGE_SIZE);
    const totalPages = Math.ceil(total / PAGE_SIZE);
    res.render("campaigns", { campaigns, page, totalPages, total, session: req.session });
  }

  async newForm(req: Request, res: Response) {
    res.render("campaign-new", { session: req.session, csrfToken: req.session.csrfToken, error: null, values: {} });
  }

  async create(req: Request, res: Response) {
    // Form → zod (eskiden ham body dogrulanmadan servise gidiyordu; gender 'man' gibi degerler sessizce hic eslesmiyordu)
    const parsed = parseCampaignForm(req.body);
    if (!parsed.success) {
      return res.status(400).render("campaign-new", {
        session: req.session, csrfToken: req.session.csrfToken, error: formatZodIssues(parsed.error.issues), values: req.body,
      });
    }
    const campaign = await campaignService.createCampaign(parsed.data, req.session.adminId!);
    res.redirect(`/admin/campaigns/${campaign.id}`);
  }

  async detail(req: Request, res: Response) {
    const id = idSchema.safeParse(req.params.id);
    const campaign = id.success ? await campaignService.getCampaignDetail(id.data) : null;
    if (!campaign) return res.status(404).render("error", { message: "Campaign not found", session: req.session });
    const breakdown = await campaignService.getCampaignBreakdown(campaign.id);
    const dailyStats = isRecurring(campaign) ? await campaignService.getRecurringDailyStats(campaign.id) : [];
    const error = req.session.campaignError;
    delete req.session.campaignError;
    res.render("campaign-detail", { campaign, breakdown, dailyStats, error, session: req.session, csrfToken: req.session.csrfToken });
  }

  send(req: Request, res: Response) {
    return this.withFlash(req, res, async (id) => {
      const result = await campaignService.sendCampaign(id);
      console.log(`[Admin] Campaign ${id} sent:`, result);
    });
  }

  cancel(req: Request, res: Response) {
    return this.withFlash(req, res, (id) => campaignService.cancelCampaign(id));
  }

  pause(req: Request, res: Response) {
    return this.setState(req, res, "paused");
  }

  resume(req: Request, res: Response) {
    return this.setState(req, res, "scheduled");
  }

  async previewCount(req: Request, res: Response) {
    const parsed = segmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: formatZodIssues(parsed.error.issues) });
    const count = await campaignService.previewSegmentCount(parsed.data);
    res.json({ count });
  }

  private setState(req: Request, res: Response, state: RecurringState) {
    return this.withFlash(req, res, (id) => campaignService.setRecurringState(id, state));
  }

  /** Servis hatasini detay sayfasina flash olarak tasir; gecersiz id 404. */
  private async withFlash(req: Request, res: Response, action: (id: string) => Promise<unknown>) {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(404).render("error", { message: "Campaign not found", session: req.session });
    try {
      await action(id.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[Admin] Campaign ${id.data} action failed:`, message);
      req.session.campaignError = message;
    }
    res.redirect(`/admin/campaigns/${id.data}`);
  }
}

export const campaignAdminController = new CampaignAdminController();
