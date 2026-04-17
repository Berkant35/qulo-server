import type { Request, Response, NextFunction } from "express";
import { supabase } from "../config/supabase.js";

/**
 * Complete mapping of API endpoints to human-readable flow step names.
 * Dynamic segments (:id, :match_id, etc.) are normalized to /:id before lookup.
 */
const ENDPOINT_TO_FLOW: Record<string, string> = {
  // ── App Config ──
  "GET /api/v1/app/config": "get_app_config",
  "GET /api/v1/app/economy": "get_economy_config",

  // ── Auth ──
  "POST /api/v1/auth/register": "register",
  "GET /api/v1/auth/verify-email": "verify_email",
  "POST /api/v1/auth/login": "login",
  "POST /api/v1/auth/social-login": "social_login",
  "POST /api/v1/auth/refresh": "token_refresh",
  "POST /api/v1/auth/logout": "logout",
  "POST /api/v1/auth/forgot-password": "forgot_password",
  "POST /api/v1/auth/reset-password": "reset_password",

  // ── User / Profile ──
  "POST /api/v1/users/me/complete-profile": "complete_profile",
  "GET /api/v1/users/me": "get_profile",
  "PATCH /api/v1/users/me": "update_profile",
  "PATCH /api/v1/users/me/details": "update_details",
  "PATCH /api/v1/users/me/location": "update_location",
  "PATCH /api/v1/users/me/push-token": "update_push_token",
  "POST /api/v1/users/me/photos": "upload_photo",
  "POST /api/v1/users/me/boost": "boost_profile",
  "POST /api/v1/users/me/claim-badge-reward": "claim_badge_reward",
  "DELETE /api/v1/users/me/photos/:id": "delete_photo",
  "GET /api/v1/users/me/notification-preferences": "get_notification_prefs",
  "PATCH /api/v1/users/me/notification-preferences": "update_notification_prefs",
  "GET /api/v1/users/me/languages": "get_languages",
  "PUT /api/v1/users/me/languages": "set_languages",
  "GET /api/v1/users/:id/profile": "view_public_profile",
  "DELETE /api/v1/users/me": "delete_account",

  // ── Questions ──
  "GET /api/v1/questions/me": "get_my_questions",
  "POST /api/v1/questions/me": "create_question",
  "PATCH /api/v1/questions/me/reorder": "reorder_questions",
  "PATCH /api/v1/questions/me/:id": "update_question",
  "DELETE /api/v1/questions/me/:id": "delete_question",
  "GET /api/v1/questions/count/me": "get_question_count",
  "GET /api/v1/questions/me/analytics": "get_question_analytics",
  "GET /api/v1/questions/me/weekly-report": "get_weekly_report",
  "POST /api/v1/questions/ai-suggest": "ai_suggest_questions",

  // ── Diamonds ──
  "GET /api/v1/diamonds/balance": "get_diamond_balance",
  "GET /api/v1/diamonds/history": "get_diamond_history",
  "POST /api/v1/diamonds/purchase": "purchase_diamonds",

  // ── Discover & Matches ──
  "GET /api/v1/matches/discover": "discover_load",
  "POST /api/v1/matches/swipe": "swipe",
  "DELETE /api/v1/matches/swipe/:id": "undo_swipe",
  "GET /api/v1/matches/list": "get_matches_list",
  "DELETE /api/v1/matches/:id": "unmatch",

  // ── Chat ──
  "GET /api/v1/chat/:id/messages": "get_messages",
  "POST /api/v1/chat/:id/messages": "send_message",
  "POST /api/v1/chat/:id/upload": "upload_chat_media",
  "POST /api/v1/chat/:id/question-upload": "upload_question_media",
  "POST /api/v1/chat/:id/read": "mark_chat_read",
  "DELETE /api/v1/chat/:id/messages/:id": "delete_message",
  "POST /api/v1/chat/:id/messages/:id/reactions": "add_reaction",
  "GET /api/v1/chat/questions/drafts": "get_question_drafts",
  "POST /api/v1/chat/questions/drafts": "save_question_draft",
  "DELETE /api/v1/chat/questions/drafts/:id": "delete_question_draft",
  "GET /api/v1/chat/questions/history": "get_question_history",
  "POST /api/v1/chat/:id/questions": "create_chat_question",
  "GET /api/v1/chat/questions/:id": "get_chat_question",
  "POST /api/v1/chat/questions/:id/answer": "answer_chat_question",
  "POST /api/v1/chat/questions/:id/use-power": "use_power_on_question",
  "POST /api/v1/chat/questions/:id/rescue": "rescue_chat_question",
  "POST /api/v1/chat/questions/:id/timeout": "timeout_chat_question",
  "POST /api/v1/chat/:id/media-request": "request_media",
  "POST /api/v1/chat/:id/media-request/:id/respond": "respond_media_request",
  "POST /api/v1/chat/:id/media-disable": "disable_media_sharing",
  "GET /api/v1/chat/:id/media-status": "get_media_status",

  // ── Quiz ──
  "POST /api/v1/quiz/start": "quiz_start",
  "GET /api/v1/quiz/match/:id/summary": "quiz_summary",
  "GET /api/v1/quiz/:id": "get_current_question",
  "POST /api/v1/quiz/:id/answer": "quiz_answer",
  "POST /api/v1/quiz/:id/rescue": "quiz_rescue",
  "POST /api/v1/quiz/:id/fail": "quiz_fail",
  "GET /api/v1/quiz/:id/result": "quiz_result",

  // ── Powers ──
  "GET /api/v1/powers": "get_powers",

  // ── Passport ──
  "POST /api/v1/passport/activate": "passport_activate",
  "POST /api/v1/passport/deactivate": "passport_deactivate",

  // ── Reports & Blocks ──
  "POST /api/v1/reports": "create_report",
  "GET /api/v1/blocks": "get_blocked_users",
  "POST /api/v1/blocks": "block_user",
  "DELETE /api/v1/blocks/:id": "unblock_user",

  // ── Webhooks ──
  "POST /api/v1/webhooks/revenuecat": "revenuecat_webhook",

  // ── Subscriptions ──
  "GET /api/v1/subscriptions/status": "get_subscription_status",
  "GET /api/v1/subscriptions/daily-stats": "get_subscription_stats",
  "POST /api/v1/subscriptions/activate": "activate_subscription",

  // ── Notifications ──
  "GET /api/v1/notifications": "get_notifications",
  "GET /api/v1/notifications/unread-count": "get_unread_count",
  "PATCH /api/v1/notifications/:id/read": "mark_notification_read",
  "POST /api/v1/notifications/read-all": "mark_all_notifications_read",
  "POST /api/v1/notifications/:id/click": "notification_click",

  // ── Exchange ──
  "POST /api/v1/exchange/convert": "exchange_convert",
  "POST /api/v1/exchange/buy-power": "buy_power",
  "GET /api/v1/exchange/inventory": "get_inventory",
  "GET /api/v1/exchange/rates": "get_exchange_rates",

  // ── Referrals ──
  "GET /api/v1/referrals/my-code": "get_referral_code",
  "GET /api/v1/referrals/stats": "get_referral_stats",
  "GET /api/v1/referrals/history": "get_referral_history",
  "POST /api/v1/referrals/validate-code": "validate_referral_code",
  "POST /api/v1/referrals/apply": "apply_referral_code",
  "GET /api/v1/referrals/my-referrer": "get_my_referrer",

  // ── Presence ──
  "POST /api/v1/users/me/presence": "presence_heartbeat",
  "POST /api/v1/users/me/presence/offline": "set_offline",

  // ── Support Tickets ──
  "POST /api/v1/support-tickets": "create_support_ticket",
  "GET /api/v1/support-tickets": "list_support_tickets",
  "GET /api/v1/support-tickets/:id": "get_support_ticket",
};

/**
 * Categorizes endpoints into flow categories for grouping.
 */
function getEventCategory(endpoint: string): string {
  if (endpoint.includes("/auth")) return "auth";
  if (endpoint.includes("/matches") || endpoint.includes("/quiz")) return "matching";
  if (endpoint.includes("/chat")) return "chat";
  if (endpoint.includes("/questions")) return "questions";
  if (endpoint.includes("/diamonds") || endpoint.includes("/exchange") || endpoint.includes("/powers") || endpoint.includes("/subscriptions")) return "economy";
  if (endpoint.includes("/users")) return "profile";
  if (endpoint.includes("/passport")) return "passport";
  if (endpoint.includes("/notifications")) return "notifications";
  if (endpoint.includes("/reports") || endpoint.includes("/blocks")) return "moderation";
  if (endpoint.includes("/referrals")) return "referral";
  if (endpoint.includes("/support-tickets")) return "support";
  if (endpoint.includes("/app")) return "app";
  if (endpoint.includes("/webhooks")) return "webhook";
  return "other";
}

/**
 * Normalizes a request path by replacing UUIDs and numeric IDs with /:id.
 */
function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id") // UUIDs
    .replace(/\/\d+(?=\/|$)/g, "/:id"); // Numeric IDs (e.g. /photos/3)
}

// In-memory buffer for batch inserts (reduces DB writes)
let eventBuffer: Array<{
  user_id: string | null;
  session_id: string | null;
  event_category: string;
  event_name: string;
  endpoint: string;
  method: string;
  status_code: number;
  response_time_ms: number;
  metadata: Record<string, any>;
}> = [];

const FLUSH_INTERVAL_MS = 10_000; // Flush every 10 seconds
const FLUSH_SIZE = 50; // Or when buffer reaches 50 events
const MAX_BUFFER_SIZE = 5000; // Drop oldest events if buffer grows beyond this (prevents OOM)

let flushing = false; // Prevent concurrent flushes

async function flushBuffer() {
  if (eventBuffer.length === 0 || flushing) return;
  flushing = true;

  // Drop oldest events if buffer is too large (last-resort OOM protection)
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    const dropped = eventBuffer.length - MAX_BUFFER_SIZE;
    eventBuffer = eventBuffer.slice(-MAX_BUFFER_SIZE);
    console.warn(`[flow-tracker] Buffer overflow, dropped ${dropped} oldest events`);
  }

  const batch = eventBuffer.splice(0, eventBuffer.length);
  try {
    const { error } = await supabase.from("flow_events").insert(batch);
    if (error) {
      console.error("[flow-tracker] Insert error:", error.message);
    }
  } catch (err) {
    console.error("[flow-tracker] Flush failed:", (err as Error).message);
  } finally {
    flushing = false;
  }
}

// Periodic flush
setInterval(flushBuffer, FLUSH_INTERVAL_MS);

/**
 * Express middleware that tracks API calls for flow analytics.
 * Non-blocking: errors in tracking never affect the API response.
 */
export function flowTracker(req: Request, res: Response, next: NextFunction): void {
  // Skip non-API and admin routes
  if (!req.path.startsWith("/api/v1")) {
    return next();
  }

  // Skip health/ping and analytics ingestion (avoid self-tracking)
  if (req.path === "/health" || req.path === "/ping" || req.path === "/api/v1/analytics/track") {
    return next();
  }

  const startTime = Date.now();

  // Hook into response finish
  res.on("finish", () => {
    try {
      const responseTime = Date.now() - startTime;
      const normalizedPath = normalizePath(req.path);
      const endpointKey = `${req.method} ${normalizedPath}`;
      const flowName = ENDPOINT_TO_FLOW[endpointKey] || endpointKey;
      const category = getEventCategory(req.path);
      const userId = req.user?.userId || null;

      // Extract session from header
      const sessionId = (req.headers["x-session-id"] as string) || null;

      eventBuffer.push({
        user_id: userId,
        session_id: sessionId,
        event_category: category,
        event_name: flowName,
        endpoint: normalizedPath,
        method: req.method,
        status_code: res.statusCode,
        response_time_ms: responseTime,
        metadata: {
          ...(req.query && Object.keys(req.query).length > 0 ? { query: req.query } : {}),
          user_agent: req.headers["user-agent"]?.substring(0, 100),
        },
      });

      // Flush if buffer is full
      if (eventBuffer.length >= FLUSH_SIZE) {
        flushBuffer().catch(() => {});
      }
    } catch {
      // Never let tracking errors affect the response
    }
  });

  next();
}

// Export for graceful shutdown
export async function flushFlowEvents(): Promise<void> {
  await flushBuffer();
}
