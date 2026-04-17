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

export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
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
