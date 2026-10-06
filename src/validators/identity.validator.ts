import { z } from "zod";
import { GENDER_LABELS, ORIENTATION_LABELS, MAX_LABELS_PER_GROUP } from "../constants/identity-labels.js";

const unique = (labels: string[]) => new Set(labels).size === labels.length;

/** PUT /users/me/identity. Rıza kuralı serviste (IDENTITY_CONSENT_REQUIRED) — istemci ayırt edebilsin. */
export const identitySchema = z.object({
  gender_labels: z.array(z.enum(GENDER_LABELS)).max(MAX_LABELS_PER_GROUP).refine(unique, "duplicate label"),
  orientation_labels: z.array(z.enum(ORIENTATION_LABELS)).max(MAX_LABELS_PER_GROUP).refine(unique, "duplicate label"),
  show_gender_labels: z.boolean(),
  show_orientation_labels: z.boolean(),
  consent: z.boolean().optional(),
  version: z.string().trim().min(1).max(20).optional(),
});

export type IdentityInput = z.infer<typeof identitySchema>;
