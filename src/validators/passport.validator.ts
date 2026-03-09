import { z } from "zod";

export const activatePassportSchema = z.object({
  city: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type ActivatePassportInput = z.infer<typeof activatePassportSchema>;
