import { describe, it, expect } from 'vitest';
import { isEligibleUser, isEmailFallbackUser } from '../../../src/services/notification-engine/context.js';

const base = { is_deleted: false, is_banned: false, is_test_account: false, is_seed_profile: false, push_token: 'tok' };

describe('bildirim uygunlugu — seed/test hedef asla push ya da e-posta yedegi almaz', () => {
  it('gercek kullanici: token varsa push adayi, yoksa e-posta yedegi adayi', () => {
    expect(isEligibleUser(base)).toBe(true);
    expect(isEmailFallbackUser(base)).toBe(false);
    expect(isEmailFallbackUser({ ...base, push_token: null })).toBe(true);
  });

  it('seed profili (geri yuklenen seed\'ler: iki bayrak true, token yok) iki kanalda da elenir', () => {
    const seed = { ...base, is_seed_profile: true, is_test_account: true, push_token: null };
    expect(isEligibleUser(seed)).toBe(false);
    expect(isEmailFallbackUser(seed)).toBe(false);
    // tek bayrak da yeter (bayraklardan biri elle dusurulse bile)
    expect(isEmailFallbackUser({ ...seed, is_test_account: false })).toBe(false);
    expect(isEmailFallbackUser({ ...seed, is_seed_profile: false })).toBe(false);
    expect(isEligibleUser({ ...seed, push_token: 'tok' })).toBe(false);
  });
});
