import { describe, it, expect } from 'vitest';
import { rcWebhookSchema } from '../../src/validators/webhook.validator.js';

/**
 * `validate` middleware req.body'yi zod çıktısıyla DEĞİŞTİRİR — şemada olmayan alan sessizce
 * düşer. Ödenmiş uygunluğu (F4) environment / period_type / is_family_share alanlarına bağlı:
 * şema onları tanımazsa servis hep "bilinmiyor" görür ve hiçbir satın alma ödenmiş sayılmaz.
 */
describe('rcWebhookSchema', () => {
  const base = { type: 'NON_RENEWING_PURCHASE', app_user_id: 'u1', product_id: 'qulopurple50', store: 'APP_STORE' };

  it('ödenmiş uygunluğu alanlarını korur', () => {
    const parsed = rcWebhookSchema.parse({
      event: { ...base, environment: 'PRODUCTION', period_type: 'NORMAL', is_family_share: false, price: 0.99 },
    });
    expect(parsed.event).toMatchObject({
      environment: 'PRODUCTION', period_type: 'NORMAL', is_family_share: false, price: 0.99,
    });
  });

  it('alanlar yok ya da null olabilir (RevenueCat price null gönderebilir) — olay reddedilmez', () => {
    expect(rcWebhookSchema.safeParse({ event: base }).success).toBe(true);
    expect(rcWebhookSchema.safeParse({ event: { ...base, price: null, period_type: null, is_family_share: null } }).success)
      .toBe(true);
  });

  it('bilinmeyen gelecekteki bir ortam/dönem değeri olayı düşürmez (400 = RevenueCat sonsuz retry)', () => {
    expect(rcWebhookSchema.safeParse({ event: { ...base, environment: 'STAGING', period_type: 'PREPAID' } }).success)
      .toBe(true);
  });

  it('tüketilebilir olay ve iadesi expiration_at_ms: null gönderir — reddedilmez; cancel_reason korunur', () => {
    const parsed = rcWebhookSchema.safeParse({
      event: {
        ...base, type: 'CANCELLATION', transaction_id: 'tx-1', expiration_at_ms: null,
        purchased_at_ms: null, cancel_reason: 'CUSTOMER_SUPPORT', price: -4.99,
      },
    });
    expect(parsed.success).toBe(true);
    const ev = parsed.success ? parsed.data.event : undefined;
    expect(ev && 'cancel_reason' in ev ? ev.cancel_reason : undefined).toBe('CUSTOMER_SUPPORT');
  });

  /** TRANSFER'de `app_user_id`/`product_id` yok (RevenueCat docs) — eskiden 400 alıp düşüyordu. */
  it('TRANSFER app_user_id/product_id olmadan kabul edilir, aktarım listeleri korunur', () => {
    const parsed = rcWebhookSchema.safeParse({
      event: {
        type: 'TRANSFER', id: 'evt-1', app_id: 'app1', event_timestamp_ms: 1, store: 'APP_STORE',
        environment: 'PRODUCTION', transferred_from: ['u-old'], transferred_to: ['u-new'],
      },
      api_version: '1.0',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.event).toMatchObject({
      type: 'TRANSFER', transferred_from: ['u-old'], transferred_to: ['u-new'],
    });
  });

  it('aktarım listesi olmayan TRANSFER ve app_user_id olmayan diğer olaylar reddedilir', () => {
    expect(rcWebhookSchema.safeParse({ event: { type: 'TRANSFER', store: 'APP_STORE' } }).success).toBe(false);
    const { app_user_id: _omit, ...withoutUser } = base;
    expect(rcWebhookSchema.safeParse({ event: withoutUser }).success).toBe(false);
  });

  it('listesiz TRANSFER app_user_id/product_id taşısa da satın alma olayı gibi kabul edilmez', () => {
    expect(rcWebhookSchema.safeParse({ event: { ...base, type: 'TRANSFER' } }).success).toBe(false);
  });

  it('TRANSFER: bilinmeyen store kabul edilir (400 = RevenueCat yeniden dener), 10\'dan uzun liste reddedilir', () => {
    const ok = { type: 'TRANSFER', transferred_from: ['a'], transferred_to: ['b'], store: 'PROMOTIONAL' };
    expect(rcWebhookSchema.safeParse({ event: ok }).success).toBe(true);
    const many = Array.from({ length: 11 }, (_, i) => `u${i}`);
    expect(rcWebhookSchema.safeParse({ event: { ...ok, transferred_from: many } }).success).toBe(false);
  });
});
