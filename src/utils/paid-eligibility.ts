/**
 * "Ödenmiş" mor kuralı — rainbow'un (hediye kartına, yani gerçek paraya dönen elmasın) tek kaynağı.
 *
 * Yalnız GERÇEK, TAM FİYATLI, KENDİ satın alması ödenmiş sayılır (controller kararı 2026-09-27):
 * mağaza ortamı PRODUCTION (sandbox değil), aile paylaşımı değil ve — abonelikte — dönem NORMAL.
 * TRIAL / INTRO / PROMOTIONAL (ve PREPAID) → 0. Aksi hâlde TestFlight / lisans testçisi / aile
 * üyesi 0 TL'ye "ödenmiş" mor → rainbow üretebilirdi. Mor yine yatar; yalnız etiket 0 olur.
 *
 * Eksik alan = bilinmiyor = UYGUN DEĞİL (fail-safe): yanlış "hayır" yalnız daha az rainbow demek,
 * yanlış "evet" bedava paraya dönüşür.
 */
export interface StorePurchaseFacts {
  /** true = sandbox, false = PRODUCTION, undefined = bilinmiyor. */
  sandbox: boolean | undefined;
  /** true = aile paylaşımı, false = kendi satın alması, undefined = bilinmiyor. */
  familyShared: boolean | undefined;
  /** Yalnız abonelik: RevenueCat `period_type` (webhook BÜYÜK harf, API v1 küçük harf). */
  periodType?: string;
}

export type PurchaseKind = "consumable" | "subscription";

export function isPaidEligible(facts: StorePurchaseFacts, kind: PurchaseKind): boolean {
  if (facts.sandbox !== false) return false;
  if (facts.familyShared !== false) return false;
  if (kind === "subscription" && facts.periodType?.toUpperCase() !== "NORMAL") return false;
  return true;
}

/**
 * RevenueCat webhook olayı → gerçekler. Alanlar (docs: integrations/webhooks/event-types-and-fields):
 * `environment` "SANDBOX" | "PRODUCTION", `is_family_share` boolean (App Store dışı hep false),
 * `period_type` "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL" | "PREPAID".
 */
export function webhookPurchaseFacts(event: {
  environment?: string | null;
  is_family_share?: boolean | null;
  period_type?: string | null;
}): StorePurchaseFacts {
  const env = event.environment ?? undefined;
  return {
    sandbox: env === undefined ? undefined : env !== "PRODUCTION",
    familyShared: event.is_family_share ?? undefined,
    periodType: event.period_type ?? undefined,
  };
}

/**
 * RevenueCat API v1 `subscriber.subscriptions[productId]` → gerçekler. Alanlar (docs: api-v1
 * customer-info-model): `is_sandbox` boolean, `ownership_type` "PURCHASED" | "FAMILY_SHARED",
 * `period_type` "normal" | "trial" | "intro" | "promotional" | "prepaid".
 */
export function subscriberSubscriptionFacts(sub: {
  isSandbox?: boolean;
  ownershipType?: string;
  periodType?: string;
}): StorePurchaseFacts {
  return {
    sandbox: sub.isSandbox,
    familyShared: sub.ownershipType === undefined ? undefined : sub.ownershipType !== "PURCHASED",
    periodType: sub.periodType,
  };
}
