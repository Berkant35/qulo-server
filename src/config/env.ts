import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),

  // Firebase
  FIREBASE_SERVICE_ACCOUNT: z.string().default("{}"),

  // SMTP (optional)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // App
  APP_URL: z.string().url().default("http://localhost:3000"),

  // RevenueCat
  REVENUECAT_WEBHOOK_SECRET: z.string().default(''),
  REVENUECAT_API_KEY: z.string().default(''),

  // Gemini AI
  GEMINI_API_KEY: z.string().default(''),

  // Deep Links
  ANDROID_SHA256_FINGERPRINT: z.string().default(''),

  // Admin
  ADMIN_SESSION_SECRET: z.string().min(1),
  ADMIN_SEED_EMAIL: z.string().email().optional(),
  ADMIN_SEED_PASSWORD: z.string().min(8).optional(),
  ADMIN_ALLOWED_IPS: z.string().optional(),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
