export class ScoringService {
  /**
   * Desirability score based on like-to-shown ratio.
   */
  desirabilityScore(likeReceived: number, timesShown: number): number {
    if (timesShown === 0) return 5;
    const ratio = likeReceived / timesShown;
    if (ratio > 0.6) return 10;
    if (ratio > 0.4) return 7;
    if (ratio > 0.2) return 5;
    if (ratio > 0.1) return 3;
    return 1;
  }

  /**
   * Recency score based on hours since last seen.
   */
  recencyScore(lastSeenAt: string): number {
    const hours = (Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60 * 60);
    if (hours <= 1) return 10;
    if (hours <= 6) return 8;
    if (hours <= 24) return 6;
    if (hours <= 72) return 3;
    if (hours <= 168) return 1;
    return 0;
  }

  /**
   * Distance score — closer is better.
   */
  distanceScore(distanceKm: number, maxRadius: number): number {
    return Math.max(0, (1 - distanceKm / maxRadius) * 10);
  }

  /**
   * Profile completeness score.
   */
  profileScore(completion: number, photoCount: number, hasBio: boolean): number {
    const base = (completion / 100) * 10;
    const photoBonus = photoCount >= 3 ? 2 : 0;
    const bioBonus = hasBio ? 1 : 0;
    return Math.min(13, base + photoBonus + bioBonus);
  }

  /**
   * Engagement score based on green diamonds and quiz completion rate.
   */
  engagementScore(greenDiamonds: number, quizCompletionRate: number): number {
    return Math.min(greenDiamonds / 50, 5) + quizCompletionRate * 5;
  }

  /**
   * Total weighted score.
   */
  totalScore(params: {
    desirability: number;
    engagement: number;
    recency: number;
    distance: number;
    profile: number;
    boostActive: boolean;
  }): number {
    const weighted =
      params.desirability * 0.25 +
      params.engagement * 0.25 +
      params.recency * 0.20 +
      params.distance * 0.15 +
      params.profile * 0.10;

    return weighted + (params.boostActive ? 50 : 0);
  }
}

export const scoringService = new ScoringService();
