import { z } from 'zod';

export const rcWebhookSchema = z.object({
  event: z.object({
    type: z.string(),
    app_user_id: z.string(),
    product_id: z.string(),
    store: z.enum(['APP_STORE', 'PLAY_STORE']).optional(),
    purchased_at_ms: z.number().optional(),
    expiration_at_ms: z.number().optional(),
    transaction_id: z.string().optional(),
    original_transaction_id: z.string().optional(),
    // "Ödenmiş" uygunluğu (utils/paid-eligibility). validate() gövdeyi zod çıktısıyla değiştirir:
    // burada olmayan alan servise hiç ulaşmaz. Serbest string/null: bilinmeyen yeni bir değer
    // olayı 400'e düşürmesin (RevenueCat 4xx'te yeniden dener) — servis onu "uygun değil" sayar.
    environment: z.string().nullish(),
    period_type: z.string().nullish(),
    is_family_share: z.boolean().nullish(),
    price: z.number().nullish(),
  }),
  api_version: z.string().optional(),
});
