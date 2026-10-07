import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// Capacitor bundles the web build into the APK; the PWA build is the same output served over HTTPS.
export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: mode !== 'production' ? true : false,
    chunkSizeWarningLimit: 1200,
  },
  server: { host: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered manually in src/platform/pwa.ts (skipped inside Capacitor)
      includeAssets: ['icons/*.png', 'icons/*.svg', 'fonts/*', 'privacy.html'],
      manifest: {
        name: 'PRESS',
        short_name: 'PRESS',
        description: 'A risograph print-shop block puzzle roguelite.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        orientation: 'portrait',
        background_color: '#F2ECDF',
        theme_color: '#F2ECDF',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff,woff2,otf,ttf,json}'],
        navigateFallbackDenylist: [/privacy\.html$/],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    // Property tests brute-force thousands of boards; coverage instrumentation on a shared CI
    // runner can be 3-4x slower than a laptop, so the 5 s default is too tight.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/*.test.ts', 'src/core/**/index.ts', 'src/core/**/types.ts'],
      thresholds: { lines: 98, functions: 98, statements: 98, branches: 92 },
      reporter: ['text', 'html', 'json-summary'],
    },
  },
}));
