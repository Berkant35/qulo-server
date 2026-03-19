import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import { env } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import questionRoutes from "./routes/question.routes.js";
import diamondRoutes from "./routes/diamond.routes.js";
import matchRoutes from "./routes/match.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import quizRoutes from "./routes/quiz.routes.js";
import powerRoutes from "./routes/power.routes.js";
import passportRoutes from "./routes/passport.routes.js";
import reportRoutes from "./routes/report.routes.js";
import blockRoutes from "./routes/block.routes.js";
import webhookRoutes from "./routes/webhook.routes.js";
import subscriptionRoutes from "./routes/subscription.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import exchangeRoutes from "./routes/exchange.routes.js";
import referralRoutes from "./routes/referral.routes.js";
import appRoutes from "./routes/app.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { idempotencyMiddleware } from "./middleware/idempotency.js";
import adminRoutes from "./admin/admin.routes.js";
import { adminService } from "./admin/admin.service.js";
import { ensureStorageBuckets } from "./config/supabase.js";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "admin", "views"));

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "form-action": null,
      "img-src": ["'self'", "data:", "https:"],
      "upgrade-insecure-requests": env.NODE_ENV === "production" ? [] : null,
    },
  },
  hsts: env.NODE_ENV === "production",
}));
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(idempotencyMiddleware);

// Admin session middleware
app.use(
  session({
    secret: env.ADMIN_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: env.NODE_ENV === "production" ? "strict" : "lax",
      maxAge: 2 * 60 * 60 * 1000, // 2 hours
    },
  }),
);

// Parse URL-encoded bodies for admin forms
app.use("/admin", express.urlencoded({ extended: false }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Ping-pong
app.get("/ping", (_req, res) => {
  res.json({
    pong: true,
    version: "0.1.0",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// Apple Universal Links
app.get("/.well-known/apple-app-site-association", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: "5W2U3NK284.com.wordpress.calikusuberkant.qulorelease",
          paths: ["/invite/*"],
        },
      ],
    },
  });
});

// Android App Links
app.get("/.well-known/assetlinks.json", (_req, res) => {
  res.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "com.wordpress.calikusuberkant.qulo",
        sha256_cert_fingerprints: [env.ANDROID_SHA256_FINGERPRINT || "TODO:ADD_YOUR_SHA256_FINGERPRINT"],
      },
    },
  ]);
});

// Email verification callback (Supabase Auth redirects here)
app.get("/", (_req, res) => {
  res.render("email-verified");
});

// Admin backoffice
app.use("/admin", adminRoutes);

// Routes
app.use("/api/v1/app", appRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/questions", questionRoutes);
app.use("/api/v1/diamonds", diamondRoutes);
app.use("/api/v1/matches", matchRoutes);
app.use("/api/v1/chat", chatRoutes);
app.use("/api/v1/quiz", quizRoutes);
app.use("/api/v1/powers", powerRoutes);
app.use("/api/v1/passport", passportRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use("/api/v1/blocks", blockRoutes);
app.use("/api/v1/webhooks", webhookRoutes);
app.use("/api/v1/subscriptions", subscriptionRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/exchange", exchangeRoutes);
app.use("/api/v1/referrals", referralRoutes);

// Error handler (must be last)
app.use(errorHandler);

// Start server
app.listen(env.PORT, () => {
  console.log(
    `[server] Running on port ${env.PORT} in ${env.NODE_ENV} mode`,
  );

  // Seed admin user
  if (env.ADMIN_SEED_EMAIL && env.ADMIN_SEED_PASSWORD) {
    adminService.seedAdmin(env.ADMIN_SEED_EMAIL, env.ADMIN_SEED_PASSWORD).catch(console.error);
  }

  ensureStorageBuckets().catch(console.error);
});

export default app;
