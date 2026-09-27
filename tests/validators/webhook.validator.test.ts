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
});
