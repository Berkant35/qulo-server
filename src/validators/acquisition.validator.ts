import { z } from "zod";

export const submitAnswerSchema = z
  .object({
    channel_id: z.string().uuid().optional(),
    skipped: z.boolean().optional(),
    freeform_text: z.string().max(280).optional(),
  })
  .refine((d) => d.skipped === true || !!d.channel_id, {
    message: "channel_id or skipped is required",
  })
  .refine((d) => !(d.skipped === true && d.channel_id), {
    message: "channel_id and skipped cannot be combined",
  });

export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;
