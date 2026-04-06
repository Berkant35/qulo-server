import type { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth.service.js";
import { env } from "../config/env.js";
import type { RegisterInput, LoginInput, RefreshInput, ForgotPasswordInput, ResetPasswordInput } from "../validators/auth.validator.js";

export async function registerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = req.body as RegisterInput;
    const result = await authService.register(data);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function verifyEmailHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.query as { token: string };
    await authService.verifyEmail(token);

    const locale = detectLocale(req);
    res.redirect(302, `${env.WEB_URL}/${locale}/email-verified?status=success`);
  } catch (err: unknown) {
    const locale = detectLocale(req);
    const status = isTokenExpiredError(err) ? "expired" : "error";
    res.redirect(302, `${env.WEB_URL}/${locale}/email-verified?status=${status}`);
  }
}

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body as LoginInput;
    const result = await authService.login(email, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = req.body as RefreshInput;
    const result = await authService.refresh(refreshToken);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function logoutHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.user!.userId;
    const refreshToken = req.body?.refreshToken as string | undefined;
    await authService.logout(userId, refreshToken);
    res.json({ message: "Logged out" });
  } catch (err) {
    next(err);
  }
}

export async function forgotPasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = req.body as ForgotPasswordInput;
    await authService.forgotPassword(email);
    // Always return success to not reveal if email exists
    res.json({ message: "If the email exists, a reset link has been sent" });
  } catch (err) {
    next(err);
  }
}

export async function resetPasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, password } = req.body as ResetPasswordInput;
    const result = await authService.resetPassword(token, password);
    res.json({ message: "Password reset successful", ...result });
  } catch (err) {
    next(err);
  }
}

export async function socialLoginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = req.body as import("../validators/auth.validator.js").SocialLoginInput;
    const result = await authService.socialLogin(data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

function detectLocale(req: Request): string {
  const acceptLang = req.headers["accept-language"] || "";
  return acceptLang.includes("tr") ? "tr" : "en";
}

function isTokenExpiredError(err: unknown): boolean {
  return (err as { code?: string })?.code === "TOKEN_EXPIRED";
}
