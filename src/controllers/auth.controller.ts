import type { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth.service.js";
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
    const result = await authService.verifyEmail(token);

    const acceptLang = req.headers["accept-language"] || "";
    const isTurkish = acceptLang.includes("tr");

    const title = isTurkish ? "E-posta Doğrulandı!" : "Email Verified!";
    const message = isTurkish
      ? "Hesabınız başarıyla aktifleştirildi. Uygulamaya dönebilirsiniz."
      : "Your account has been successfully activated. You can return to the app.";
    const buttonText = isTurkish ? "Uygulamayı Aç" : "Open App";

    res.send(buildVerifyHtml(title, message, buttonText, true));
  } catch (err) {
    const acceptLang = req.headers["accept-language"] || "";
    const isTurkish = acceptLang.includes("tr");

    const title = isTurkish ? "Geçersiz Bağlantı" : "Invalid Link";
    const message = isTurkish
      ? "Bu doğrulama bağlantısı geçersiz veya süresi dolmuş."
      : "This verification link is invalid or has expired.";

    res.status(400).send(buildVerifyHtml(title, message, "", false));
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

function buildVerifyHtml(title: string, message: string, buttonText: string, success: boolean): string {
  const color = success ? "#4CAF50" : "#F44336";
  const icon = success ? "✓" : "✕";
  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#FAF5FF;display:flex;justify-content:center;align-items:center;min-height:100vh}
.card{background:#fff;border-radius:16px;padding:40px;max-width:420px;text-align:center;box-shadow:0 4px 20px rgba(156,39,176,.15)}
.icon{width:64px;height:64px;border-radius:50%;background:${color};color:#fff;font-size:32px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
h1{color:#333;font-size:24px;margin:0 0 12px}
p{color:#666;font-size:15px;line-height:1.6;margin:0 0 24px}
.btn{display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#9C27B0,#7B1FA2);color:#fff;text-decoration:none;border-radius:12px;font-weight:600;font-size:16px}
.footer{margin-top:30px;color:#999;font-size:12px}
</style>
</head><body>
<div class="card">
<div class="icon">${icon}</div>
<h1>${title}</h1>
<p>${message}</p>
${buttonText ? `<a class="btn" href="qulo://">${buttonText}</a>` : ""}
<div class="footer">&copy; ${new Date().getFullYear()} Qulo</div>
</div>
</body></html>`;
}
