export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly params?: Record<string, unknown>;

  constructor(
    code: string,
    statusCode: number,
    message?: string,
    params?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.code = code;
    this.statusCode = statusCode;
    this.params = params;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const Errors = {
  INVALID_CREDENTIALS: () =>
    new AppError("INVALID_CREDENTIALS", 401, "Invalid credentials"),

  EMAIL_NOT_VERIFIED: () =>
    new AppError("EMAIL_NOT_VERIFIED", 403, "Email not verified"),

  EMAIL_ALREADY_EXISTS: () =>
    new AppError("EMAIL_ALREADY_EXISTS", 409, "Email already exists"),

  TOKEN_EXPIRED: () =>
    new AppError("TOKEN_EXPIRED", 401, "Token expired"),

  INVALID_TOKEN: () =>
    new AppError("INVALID_TOKEN", 401, "Invalid token"),

  SESSION_EXPIRED: () =>
    new AppError("SESSION_EXPIRED", 410, "Session expired"),

  TIME_UP: () =>
    new AppError("TIME_UP", 410, "Time is up"),

  ALREADY_ANSWERED: () =>
    new AppError("ALREADY_ANSWERED", 409, "Already answered"),

  SESSION_NOT_FOUND: () =>
    new AppError("SESSION_NOT_FOUND", 404, "Session not found"),

  INSUFFICIENT_DIAMONDS: (required: number, current: number) =>
    new AppError("INSUFFICIENT_DIAMONDS", 403, "Insufficient diamonds", {
      required,
      current,
    }),

  INVALID_RECEIPT: () =>
    new AppError("INVALID_RECEIPT", 400, "Invalid receipt"),

  DUPLICATE_RECEIPT: () =>
    new AppError("DUPLICATE_RECEIPT", 409, "Duplicate receipt"),

  ALREADY_SWIPED: () =>
    new AppError("ALREADY_SWIPED", 409, "Already swiped"),

  NO_QUESTIONS: () =>
    new AppError("NO_QUESTIONS", 400, "No questions available"),

  SELF_SWIPE: () =>
    new AppError("SELF_SWIPE", 400, "Cannot swipe yourself"),

  NOT_MATCHED: () =>
    new AppError("NOT_MATCHED", 403, "Not matched"),

  MATCH_INACTIVE: () =>
    new AppError("MATCH_INACTIVE", 403, "Match is inactive"),

  PROFILE_INCOMPLETE: () =>
    new AppError("PROFILE_INCOMPLETE", 400, "Profile is incomplete"),

  MAX_PHOTOS_REACHED: () =>
    new AppError("MAX_PHOTOS_REACHED", 400, "Maximum photos reached"),

  MAX_QUESTIONS_REACHED: () =>
    new AppError("MAX_QUESTIONS_REACHED", 400, "Maximum questions reached"),

  USER_NOT_FOUND: () =>
    new AppError("USER_NOT_FOUND", 404, "User not found"),

  RATE_LIMITED: () =>
    new AppError("RATE_LIMITED", 429, "Too many requests"),

  VALIDATION_ERROR: (details: Record<string, unknown>) =>
    new AppError("VALIDATION_ERROR", 400, "Validation error", { details }),

  SERVER_ERROR: () =>
    new AppError("SERVER_ERROR", 500, "Internal server error"),

  INVALID_WEBHOOK_AUTH: () =>
    new AppError("INVALID_WEBHOOK_AUTH", 401),

  SUBSCRIPTION_NOT_FOUND: () =>
    new AppError("SUBSCRIPTION_NOT_FOUND", 404),

  DUPLICATE_TRANSACTION: () =>
    new AppError("DUPLICATE_TRANSACTION", 409),

  DAILY_LIMIT_EXCEEDED: (resource: string) =>
    new AppError("DAILY_LIMIT_EXCEEDED", 403, `Daily ${resource} limit exceeded`, { resource }),

  PASSPORT_REQUIRES_PREMIUM: () =>
    new AppError("PASSPORT_REQUIRES_PREMIUM", 403, "Passport mode requires Premium subscription"),

  PASSPORT_ALREADY_ACTIVE: () =>
    new AppError("PASSPORT_ALREADY_ACTIVE", 409, "Passport is already active"),

  INVALID_REFERRAL_CODE: () =>
    new AppError("INVALID_REFERRAL_CODE", 404, "Referral code not found"),

  REFERRAL_LIMIT_REACHED: () =>
    new AppError("REFERRAL_LIMIT_REACHED", 409, "Referral limit reached (max 10)"),

  SELF_REFERRAL: () =>
    new AppError("SELF_REFERRAL", 400, "Cannot refer yourself"),

  ALREADY_REFERRED: () =>
    new AppError("ALREADY_REFERRED", 409, "User already has a referrer"),
} as const;
