import { describe, it, expect } from 'vitest';
import {
  isPaidEligible,
  webhookPurchaseFacts,
  subscriberSubscriptionFacts,
} from '../../src/utils/paid-eligibility.js';

/**
 * "Ödenmiş" etiketi rainbow'un (gerçek paraya dönen elmasın) tek kaynağı. Yalnız gerçek, tam
 * fiyatlı, kendi satın alması sayılır: sandbox (TestFlight/lisans testçisi), aile paylaşımı,
 * TRIAL/INTRO/PROMOTIONAL → 0 TL'lik "ödenmiş" mor üretirdi. Eksik alan = uygun DEĞİL.
 */
describe('isPaidEligible', () => {
  const real = { sandbox: false, familyShared: false } as const;

  it('gerçek tüketilebilir satın alma uygun', () => {
    expect(isPaidEligible(real, 'consumable')).toBe(true);
  });

  it.each([
    ['sandbox', { ...real, sandbox: true }],
    ['sandbox bilinmiyor', { ...real, sandbox: undefined }],
    ['aile paylaşımı', { ...real, familyShared: true }],
    ['aile paylaşımı bilinmiyor', { ...real, familyShared: undefined }],
  ] as const)('tüketilebilir: %s → uygun değil', (_label, facts) => {
    expect(isPaidEligible(facts, 'consumable')).toBe(false);
  });

  it.each(['NORMAL', 'normal'])('abonelik: period_type %s → uygun', (periodType) => {
    expect(isPaidEligible({ ...real, periodType }, 'subscription')).toBe(true);
  });

  it.each(['TRIAL', 'INTRO', 'PROMOTIONAL', 'PREPAID', 'trial', 'intro', undefined])(
    'abonelik: period_type %s → uygun değil',
    (periodType) => {
      expect(isPaidEligible({ ...real, periodType }, 'subscription')).toBe(false);
    },
  );

  it('abonelik NORMAL ama sandbox → uygun değil', () => {
    expect(isPaidEligible({ sandbox: true, familyShared: false, periodType: 'NORMAL' }, 'subscription')).toBe(false);
  });
});

describe('webhookPurchaseFacts (RevenueCat webhook olayı)', () => {
  it('PRODUCTION + aile paylaşımı yok + NORMAL', () => {
    expect(webhookPurchaseFacts({ environment: 'PRODUCTION', is_family_share: false, period_type: 'NORMAL' }))
      .toEqual({ sandbox: false, familyShared: false, periodType: 'NORMAL' });
  });

  it('SANDBOX → sandbox; alan yoksa bilinmiyor', () => {
    expect(webhookPurchaseFacts({ environment: 'SANDBOX', is_family_share: true }))
      .toEqual({ sandbox: true, familyShared: true, periodType: undefined });
    expect(webhookPurchaseFacts({})).toEqual({ sandbox: undefined, familyShared: undefined, periodType: undefined });
  });
});

describe('subscriberSubscriptionFacts (RevenueCat API v1 abonelik girdisi)', () => {
  it('PURCHASED + is_sandbox false + normal', () => {
    expect(subscriberSubscriptionFacts({ isSandbox: false, ownershipType: 'PURCHASED', periodType: 'normal' }))
      .toEqual({ sandbox: false, familyShared: false, periodType: 'normal' });
  });

  it('FAMILY_SHARED → paylaşım; ownership yoksa bilinmiyor', () => {
    expect(subscriberSubscriptionFacts({ isSandbox: false, ownershipType: 'FAMILY_SHARED', periodType: 'normal' }).familyShared)
      .toBe(true);
    expect(subscriberSubscriptionFacts({ isSandbox: false }).familyShared).toBeUndefined();
  });
});
