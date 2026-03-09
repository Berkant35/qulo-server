import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import crypto from "crypto";

declare module "express-session" {
  interface SessionData {
    adminId?: string;
    adminEmail?: string;
    adminRole?: string;
    csrfToken?: string;
    campaignError?: string;
  }
}

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.adminId) {
    res.redirect("/admin/login");
    return;
  }
  req.session.cookie.maxAge = 2 * 60 * 60 * 1000;
  next();
}

export function superAdminOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.session.adminRole !== "SUPER_ADMIN") {
    res.status(403).render("error", { message: "Access denied. Super Admin only.", session: req.session });
    return;
  }
  next();
}

export function ipWhitelist(req: Request, res: Response, next: NextFunction): void {
  const allowedIps = env.ADMIN_ALLOWED_IPS;
  if (!allowedIps || allowedIps.trim() === "") {
    next();
    return;
  }
  const allowed = allowedIps.split(",").map((ip) => ip.trim());
  const clientIp = req.ip || req.socket.remoteAddress || "";
  if (!allowed.includes(clientIp)) {
    res.status(403).send("Forbidden");
    return;
  }
  next();
}

export function csrfGenerate(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  next();
}

export function csrfValidate(req: Request, res: Response, next: NextFunction): void {
  const token = req.body._csrf;
  if (!token || !req.session.csrfToken || token !== req.session.csrfToken) {
    res.redirect("/admin/login");
    return;
  }
  req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  next();
}
