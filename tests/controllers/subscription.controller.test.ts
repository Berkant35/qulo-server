import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * İstemci abonelik yolu (`POST /subscriptions/activate`): aylık bonusun "ödenmiş" payı yalnız
 * RevenueCat'in doğruladığı gerçek, tam fiyatlı, kendi satın alması için (F4). Uygunluk
 * RevenueCat abone verisinden gelir; bilinmiyorsa uygun değil.
 */
async function loadHandler(verification: Record<string, unknown>) {
  const verifySubscription = vi.fn().mockResolvedValue(verification);
  const activateSubscription = vi.fn().mockResolvedValue(undefined);
  const getStatus = vi.fn().mockResolvedValue({ plan: "plus", status: "active", expiresAt: "x", isActive: true });
  const getLimits = vi.fn().mockResolvedValue({});

  vi.doMock("../../src/services/revenuecat.service.js", () => ({ revenueCatService: { verifySubscription } }));
  vi.doMock("../../src/services/subscription.service.js", () => ({
    subscriptionService: { activateSubscription, getStatus, getLimits },
  }));

  const { activateSubscriptionHandler } = await import("../../src/controllers/subscription.controller.js");
  return { activateSubscriptionHandler, activateSubscription };
}

const req = (): any => ({ user: { userId: "u1" }, body: { product_id: "quloplusmonthly2", transaction_id: "tx-1" } });
const res = (): any => ({ json: vi.fn(), status: vi.fn(() => ({ json: vi.fn() })) });
const EXPIRES = "2026-10-27T12:00:00Z";

describe("activateSubscriptionHandler — ödenmiş pay uygunluğu", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("RevenueCat uygun derse activateSubscription'a true geçer", async () => {
    const { activateSubscriptionHandler, activateSubscription } = await loadHandler({
      valid: true, expiresAt: EXPIRES, isSandbox: false, periodType: "normal", ownershipType: "PURCHASED", paidEligible: true,
    });
    const next = vi.fn();

    await activateSubscriptionHandler(req(), res(), next);

    expect(next).not.toHaveBeenCalled();
    expect(activateSubscription).toHaveBeenCalledWith("u1", "plus", "client_u1", "tx-1", EXPIRES, true);
  });

  it("deneme dönemi (trial) → false", async () => {
    const { activateSubscriptionHandler, activateSubscription } = await loadHandler({
      valid: true, expiresAt: EXPIRES, isSandbox: false, periodType: "trial", ownershipType: "PURCHASED", paidEligible: false,
    });

    await activateSubscriptionHandler(req(), res(), vi.fn());

    expect(activateSubscription).toHaveBeenCalledWith("u1", "plus", "client_u1", "tx-1", EXPIRES, false);
  });

  it("uygunluk alanı yoksa false (fail-safe)", async () => {
    const { activateSubscriptionHandler, activateSubscription } = await loadHandler({ valid: true, expiresAt: EXPIRES });

    await activateSubscriptionHandler(req(), res(), vi.fn());

    expect(activateSubscription).toHaveBeenCalledWith("u1", "plus", "client_u1", "tx-1", EXPIRES, false);
  });
});
