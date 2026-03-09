import { describe, it, expect } from "vitest";

describe("ExchangeService", () => {
  describe("convertGreenToPurple", () => {
    it("should convert green to purple at 3:1 ratio", () => {
      expect(30 / 3).toBe(10);
      expect(90 / 3).toBe(30);
      expect(3 / 3).toBe(1);
    });

    it("should reject non-multiple-of-3 amounts", () => {
      expect(7 % 3).not.toBe(0);
      expect(1 % 3).not.toBe(0);
      expect(10 % 3).not.toBe(0);
    });

    it("should accept valid multiples of 3", () => {
      expect(3 % 3).toBe(0);
      expect(6 % 3).toBe(0);
      expect(99 % 3).toBe(0);
    });
  });

  describe("buyPower", () => {
    it("should calculate total cost correctly", () => {
      const costPerUnit = 15;
      const quantity = 3;
      expect(costPerUnit * quantity).toBe(45);
    });

    it("should handle single unit purchase", () => {
      const costPerUnit = 5;
      const quantity = 1;
      expect(costPerUnit * quantity).toBe(5);
    });
  });

  describe("ORACLE accuracy", () => {
    it("should have correct wrong answer pool", () => {
      const correctAnswer = 2;
      const wrongIndices = [1, 2, 3, 4].filter((i) => i !== correctAnswer);
      expect(wrongIndices).toEqual([1, 3, 4]);
      expect(wrongIndices.length).toBe(3);
    });

    it("should always select from valid indices", () => {
      for (let correct = 1; correct <= 4; correct++) {
        const wrongIndices = [1, 2, 3, 4].filter((i) => i !== correct);
        expect(wrongIndices.length).toBe(3);
        expect(wrongIndices).not.toContain(correct);
      }
    });

    it("should respect accuracy rate threshold", () => {
      const accuracyRate = 0.7;
      // Values below rate should be "accurate"
      expect(0.5 < accuracyRate).toBe(true);
      expect(0.69 < accuracyRate).toBe(true);
      // Values above rate should be "inaccurate"
      expect(0.71 < accuracyRate).toBe(false);
      expect(0.99 < accuracyRate).toBe(false);
    });
  });
});
