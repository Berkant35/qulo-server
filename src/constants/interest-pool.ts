export const INTEREST_POOL = [
  'music',
  'movies',
  'sports',
  'career',
  'relationships',
  'travel',
  'food',
  'books',
  'gaming',
  'art',
  'fitness',
  'personality',
] as const;

export type InterestTag = typeof INTEREST_POOL[number];
