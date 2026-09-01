import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Zorunlu env degiskenlerini test moduleri yuklenmeden once doldurur;
    // aksi halde src/config/env.ts process.exit(1) cagirip sureci olduruyor.
    setupFiles: ['./tests/setup/env.ts'],
  },
});
