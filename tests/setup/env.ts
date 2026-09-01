/**
 * `src/config/env.ts` zorunlu degiskenler eksikse `process.exit(1)` cagiriyor.
 * Bazi servisler (match-email, firebase) onu transitif olarak import ettigi icin
 * env olmadan test sureci komple oluyor — CI'da `.env` yok.
 *
 * Burada sahte degerler veriliyor: testler `.env`'den bagimsiz ve tekrarlanabilir
 * olsun, CI'ya gercek secret koymak gerekmesin. Zaten hicbir test disariya
 * cikmiyor (Supabase erisimi `fake-supabase` ile mock'lu).
 *
 * Var olan degerler EZILMEZ — lokalde `.env` yuklu ise o kazanir.
 */
const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  JWT_ACCESS_SECRET: 'test-access-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  ADMIN_SESSION_SECRET: 'test-admin-session-secret',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] ??= value;
}
