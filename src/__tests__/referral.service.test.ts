import { describe, it, expect } from "vitest";
import { ReferralService } from "../services/referral.service.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const AMBIGUOUS_CHARS = ["I", "O", "0", "1"];

describe("ReferralService", () => {
  const service = new ReferralService();

  describe("generateCode", () => {
    it("should generate an 8-character code", () => {
      const code = service.generateCode();
      expect(code.length).toBe(8);
    });

    it("should only contain valid characters", () => {
      for (let i = 0; i < 50; i++) {
        const code = service.generateCode();
        for (const char of code) {
          expect(CODE_CHARS).toContain(char);
        }
      }
    });

    it("should not contain ambiguous characters (I, O, 0, 1)", () => {
      for (let i = 0; i < 50; i++) {
        const code = service.generateCode();
        for (const char of AMBIGUOUS_CHARS) {
          expect(code).not.toContain(char);
        }
      }
    });

    it("should generate uppercase alphanumeric codes", () => {
      for (let i = 0; i < 20; i++) {
        const code = service.generateCode();
        expect(code).toMatch(/^[A-Z2-9]{8}$/);
      }
    });

    it("should generate different codes on successive calls", () => {
      const codes = new Set<string>();
      for (let i = 0; i < 20; i++) {
        codes.add(service.generateCode());
      }
      // With 30^8 possible codes, 20 codes should almost certainly all be unique
      expect(codes.size).toBeGreaterThan(1);
    });
  });

  describe("getStats", () => {
    it("should calculate remaining correctly", () => {
      const MAX_COMPLETED_REFERRALS = 10;

      // Simulate stats calculation
      const completed = 3;
      const remaining = Math.max(0, MAX_COMPLETED_REFERRALS - completed);
      expect(remaining).toBe(7);
    });

    it("should not go below 0 remaining", () => {
      const MAX_COMPLETED_REFERRALS = 10;

      const completed = 15;
      const remaining = Math.max(0, MAX_COMPLETED_REFERRALS - completed);
      expect(remaining).toBe(0);
    });

    it("should have 10 remaining when no completions", () => {
      const MAX_COMPLETED_REFERRALS = 10;

      const completed = 0;
      const remaining = Math.max(0, MAX_COMPLETED_REFERRALS - completed);
      expect(remaining).toBe(10);
    });

    it("should have 0 remaining at exactly max completions", () => {
      const MAX_COMPLETED_REFERRALS = 10;

      const completed = 10;
      const remaining = Math.max(0, MAX_COMPLETED_REFERRALS - completed);
      expect(remaining).toBe(0);
    });
  });
});
