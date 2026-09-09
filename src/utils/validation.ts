const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * UUID bicim kontrolu (throw etmez).
 * PostgREST filtre string'ine deger gomen her yerde on kosul.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

/**
 * Validate that a string is a valid UUID v4 format.
 * Prevents SQL injection in PostgREST `.or()` string interpolation.
 */
export function assertUuid(value: string, label = "id"): void {
  if (!isUuid(value)) {
    throw new Error(`Invalid UUID for ${label}: ${value}`);
  }
}

/**
 * Sanitize a string for use in PostgREST ilike filters.
 * Escapes SQL wildcard characters (%, _, \).
 */
export function sanitizeIlike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}
