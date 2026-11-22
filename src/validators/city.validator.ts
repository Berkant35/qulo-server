import { z } from "zod";
import { countryCodeSchema } from "./user.validator.js";
import { CITY_SEARCH_MAX_LIMIT } from "../services/city.service.js";

/** GET /app/cities — `country` ISO alpha-2 (users.country ile ayni bicim), `q` arama metni. */
export const citySearchQuerySchema = z.object({
  country: countryCodeSchema.optional(),
  q: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(CITY_SEARCH_MAX_LIMIT).optional(),
});

export type CitySearchQuery = z.infer<typeof citySearchQuerySchema>;
