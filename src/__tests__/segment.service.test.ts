import { describe, it, expect } from "vitest";
import { segmentService } from "../services/segment.service.js";
import type { SegmentUser } from "../services/segment.service.js";

const baseUser: SegmentUser = {
  gender: "WOMAN", age: 25, city: "Istanbul", subscription_plan: "free",
  last_seen_at: new Date().toISOString(), profile_completion: 80,
  created_at: new Date().toISOString(), question_count: 0,
  green_diamonds: 10,
};

describe("matchesSegment", () => {
  it("null segment → herkes uyar", () => {
    expect(segmentService.matchesSegment(baseUser, null)).toBe(true);
  });
  it("gender eşleşmezse false", () => {
    expect(segmentService.matchesSegment(baseUser, { gender: "MAN" })).toBe(false);
  });
  it("question_count_max=0 ile hiç soru eklememiş kullanıcı uyar", () => {
    expect(segmentService.matchesSegment(baseUser, { question_count_max: 0 })).toBe(true);
    expect(segmentService.matchesSegment({ ...baseUser, question_count: 3 }, { question_count_max: 0 })).toBe(false);
  });
  it("is_premium=true ile free kullanıcı uymaz", () => {
    expect(segmentService.matchesSegment(baseUser, { is_premium: true })).toBe(false);
    expect(segmentService.matchesSegment({ ...baseUser, subscription_plan: "premium" }, { is_premium: true })).toBe(true);
  });
  it("age aralığı dışında false", () => {
    expect(segmentService.matchesSegment(baseUser, { age_min: 30 })).toBe(false);
  });
});
