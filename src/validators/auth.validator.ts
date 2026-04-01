import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().trim().min(1),
  surname: z.string().trim().min(1),
  age: z.number().int().min(18).max(99),
  gender: z.enum(["MAN", "WOMAN", "OTHER"]),
  locale: z.enum(["tr", "en"]).default("tr"),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  referral_code: z.string().min(1).max(10).optional(),
  tos_accepted: z.literal(true, {
    errorMap: () => ({ message: "Terms of Service must be accepted" }),
  }),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const socialLoginSchema = z.object({
  provider: z.enum(["google", "apple"]),
  id_token: z.string().min(1),
  name: z.string().optional(),
  surname: z.string().optional(),
  nonce: z.string().optional(),
});

export type SocialLoginInput = z.infer<typeof socialLoginSchema>;
