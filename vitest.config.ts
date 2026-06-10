import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest 4 no longer excludes build output by default. Without this,
    // `npm run build && npm test` runs every compiled dist/**/*.test.js IN
    // PARALLEL with its src/ twin — doubling the suite and making the
    // native-shim port-bind tests race each other on 127.0.0.1:3000.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-static/**',
      '**/.git/**',
    ],
  },
});
