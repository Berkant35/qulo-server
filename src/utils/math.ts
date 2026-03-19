import { QUESTION_COUNT_MULTIPLIERS, GREEN_DIAMOND_REWARD_RATIO } from "../types/index.js";

/**
 * Calculate power cost based on base cost and question count multiplier.
 */
export function calculatePowerCost(baseCost: number, questionCount: number): number {
  const multiplier = QUESTION_COUNT_MULTIPLIERS[questionCount] ?? 1.0;
  return Math.ceil(baseCost * multiplier);
}

/**
 * Calculate green diamond reward from purple diamonds spent.
 */
export function calculateGreenReward(purpleSpent: number): number {
  return Math.floor(purpleSpent * GREEN_DIAMOND_REWARD_RATIO);
}

/**
 * Fisher-Yates shuffle — returns a new shuffled array.
 */
export function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Haversine distance between two lat/lng points in kilometers.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371; // Earth's radius in km
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
