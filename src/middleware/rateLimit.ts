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

/**
 * Kimlikli rotalarda anahtar KULLANICI: IP bazli sayim NAT/CGNAT arkasindaki
 * kullanicilari birbirine 429'latiyordu (once chat'te, 2026-09-25'te swipe'da
 * yasandi). Kimliksiz istekte IP'ye duser (IPv6 /64 maskeli).
 */
export function userKey(req: { ip?: string; user?: { userId?: string } }): string {
  return req.user?.userId ?? clientKey(req);
}

// Mobil kuyruk azalinca page=1'i yeniden ceker (her ~7 swipe'ta bir); 30/dk
// tek kullanici icin bol, CGNAT'ta paylasilinca dardi.
export const discoverLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: userKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

// Guc kullanimi artik her tap'te bir API cagrisi (envanter kapisi kalkti).
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: userKey,
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

// Canli olay 2026-09-25: bir kullanici 60 sn'de 40 swipe'a dayandi, 41. istek 429
// aldi; mobil reject'i fire-and-forget attigi icin kart silindi ama swipe
// kaydedilmedi — profil sonraki acilista geri geldi ("seed'lerden sonra gercek
// kullanici cikti"). Insan hizi ~1/sn; kotuye kullanimi zaten gunluk swipe
// limiti (subscriptionService) keser, bu tavan yalniz makine hizina karsi.
export const swipeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  keyGenerator: userKey,
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

// E-posta baglantisi hedefleri (/unsubscribe, /ban-appeal): kimlik yok, token 256 bit (enumerasyon
// pratik degil) ama her istek DB sorgusu; amplifikasyona karsi IP bazli dar tavan.
export const emailLinkLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: clientKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});
