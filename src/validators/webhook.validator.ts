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
  }),
  api_version: z.string().optional(),
});
