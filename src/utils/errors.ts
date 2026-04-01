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

  MESSAGE_NOT_FOUND: () =>
    new AppError("MESSAGE_NOT_FOUND", 404, "Message not found"),

  MESSAGE_NOT_OWNER: () =>
    new AppError("MESSAGE_NOT_OWNER", 403, "Cannot delete another user's message"),

  MEDIA_ALREADY_ENABLED: () =>
    new AppError("MEDIA_ALREADY_ENABLED", 400, "Media already enabled"),

  MEDIA_REQUEST_PENDING: () =>
    new AppError("MEDIA_REQUEST_PENDING", 400, "Pending media request exists"),

  MEDIA_REQUEST_NOT_FOUND: () =>
    new AppError("MEDIA_REQUEST_NOT_FOUND", 404, "Media request not found"),

  TICKET_NOT_FOUND: () =>
    new AppError("TICKET_NOT_FOUND", 404, "Support ticket not found"),

  MEDIA_REQUEST_NOT_RECIPIENT: () =>
    new AppError("MEDIA_REQUEST_NOT_RECIPIENT", 403, "Only the recipient can respond"),

  MEDIA_NOT_ENABLED: () =>
    new AppError("MEDIA_NOT_ENABLED", 403, "Both users must enable media sharing"),

  ALREADY_BLOCKED: () =>
    new AppError("ALREADY_BLOCKED", 409, "User already blocked"),

  CANNOT_BLOCK_SELF: () =>
    new AppError("CANNOT_BLOCK_SELF", 400, "Cannot block yourself"),

  BLOCK_NOT_FOUND: () =>
    new AppError("BLOCK_NOT_FOUND", 404, "Block not found"),

  CHAT_LOCKED: () =>
    new AppError("CHAT_LOCKED", 403, "Chat is locked until the question is answered"),

  ACCOUNT_BANNED: () =>
    new AppError("ACCOUNT_BANNED", 403, "Your account has been suspended"),

  SOCIAL_AUTH_FAILED: () =>
    new AppError("SOCIAL_AUTH_FAILED", 401, "Social authentication failed"),

  SOCIAL_ACCOUNT_EXISTS: () =>
    new AppError("SOCIAL_ACCOUNT_EXISTS", 409, "This social account is already linked to another user"),

  PASSWORD_LOGIN_ONLY: () =>
    new AppError("PASSWORD_LOGIN_ONLY", 400, "This account uses email/password login"),

  SOCIAL_LOGIN_ONLY: () =>
    new AppError("SOCIAL_LOGIN_ONLY", 400, "This account was created with social login. Use Google or Apple to sign in"),

  PROFILE_NOT_COMPLETE: () =>
    new AppError("PROFILE_NOT_COMPLETE", 403, "Profile must be completed before accessing this feature"),

  UNDERAGE_USER: () =>
    new AppError("UNDERAGE_USER", 403, "You must be at least 18 years old"),

  DIAMOND_COOLDOWN: () =>
    new AppError("DIAMOND_COOLDOWN", 403, "Diamond transactions are locked for 24 hours after social signup"),

  INVALID_PHOTO_INDEX: () =>
    new AppError("INVALID_PHOTO_INDEX", 400, "Invalid photo index"),
} as const;
