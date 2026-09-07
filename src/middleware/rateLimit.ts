import rateLimit from "express-rate-limit";

const rateLimitResponse = {
  error: { code: "RATE_LIMITED" },
};

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

export const discoverLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

// Guc kullanimi artik her tap'te bir API cagrisi (envanter kapisi kalkti) — IP bazli
// sayim NAT/CGNAT arkasindaki kullanicilari birbirine 429'latiyordu. Kimlikli istekte
// kullanici bazina sayilir, anonim istekte IP'ye duser.
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => (req as { user?: { userId?: string } }).user?.userId ?? req.ip ?? "unknown",
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

export const analyticsTrackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60, // 60 requests/min/user (each can contain up to 50 events = 3000 events/min max)
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

export const swipeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

export const quizLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

export const socialAuthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 5, // 5 req/min/IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: "RATE_LIMITED", message: "Too many requests" },
});

export const quickAssignLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 10, // 10 req/5min/user
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

/**
 * IPv6'da istemci /64 prefix altında adres değiştirebilir; ham req.ip anahtarı bu
 * yüzden IPv6'da limiti boşa çıkarır. /64'e maskeleyerek anahtar üretir, IPv4 aynen.
 */
export function clientKey(req: { ip?: string }): string {
  const ip = req.ip ?? "unknown";
  if (!ip.includes(":")) return ip;
  const mapped = ip.replace(/^::ffff:/, "");
  if (!mapped.includes(":")) return mapped; // IPv4-mapped IPv6
  return ip.split(":").slice(0, 4).join(":") + "::/64";
}

// Herkese açık web testi ("beni çözebilir misin?") — kimlik yok, IP bazlı.
// Okuma ucuz ama viral link CGNAT arkasından gelir (kod tabanının chatLimiter dersi),
// bu yüzden geniş; oluşturma satır yazar, saatlik tavanı var; oynama quiz başına.
export const webQuizLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: clientKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

export const webQuizCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: clientKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

export const webQuizAttemptLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (req) => `${clientKey(req)}:${String(req.params?.slug ?? "").toUpperCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});
