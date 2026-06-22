export const PAGE_KEYS = [
  "discover", "matches", "chat", "profile", "profile_detail",
  "questions", "quiz", "diamonds", "exchange", "passport",
  "settings", "notifications",
] as const;
export type PageKey = typeof PAGE_KEYS[number];
