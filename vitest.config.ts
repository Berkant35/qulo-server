import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Zorunlu env degiskenlerini test moduleri yuklenmeden once doldurur;
    // aksi halde src/config/env.ts process.exit(1) cagirip sureci olduruyor.
    setupFiles: ['./tests/setup/env.ts'],
    // Dosyanın ilk testi servis grafiğini soğuk `await import` ile yükler (vi.resetModules deseni):
    // paralel işçilerde 1-3,4 sn ölçüldü, yük altında 5 sn'yi aşıp rastgele dosyalarda düşüyordu
    // (2026-11-14: tek koşuda 9 dosyada 12 "Test timed out in 5000ms", hepsi ilk test).
    testTimeout: 20_000,
  },
});
