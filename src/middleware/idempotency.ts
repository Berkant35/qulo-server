import { Request, Response, NextFunction } from "express";

interface CachedResponse {
  status: number;
  body: any;
  timestamp: number;
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
const HEADER_KEY = "idempotency-key";

const cache = new Map<string, CachedResponse | "processing">();

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (value === "processing") continue;
    if (now - value.timestamp > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS);

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!MUTATION_METHODS.has(req.method)) {
    return next();
  }

  const idempotencyKey = req.headers[HEADER_KEY] as string | undefined;
  if (!idempotencyKey) {
    return next();
  }

  const userId = (req as any).user?.userId ?? "anonymous";
  const cacheKey = `${userId}:${idempotencyKey}`;

  const cached = cache.get(cacheKey);

  // Cache hit — return cached response
  if (cached && cached !== "processing") {
    return res.status(cached.status).json(cached.body);
  }

  // Currently processing — return 409
  if (cached === "processing") {
    return res.status(409).json({
      error: { code: "DUPLICATE_REQUEST", message: "Request is already being processed" },
    });
  }

  // Mark as processing
  cache.set(cacheKey, "processing");

  // Override res.json to cache the response
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    const statusCode = res.statusCode;

    // Only cache 2xx responses
    if (statusCode >= 200 && statusCode < 300) {
      cache.set(cacheKey, {
        status: statusCode,
        body,
        timestamp: Date.now(),
      });
    } else {
      cache.delete(cacheKey);
    }

    return originalJson(body);
  };

  next();
}
