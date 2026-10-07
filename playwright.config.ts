import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests on emulated phones against the production build (vite preview).
 * WebGL runs on SwiftShader in headless Chromium, so frame times here say nothing about
 * device performance (see docs/performance.md for that).
 */
const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [
    { name: 'pixel-7', testIgnore: /layout\.spec\.ts/, use: { ...devices['Pixel 7'], locale: 'en-US' } },
    {
      name: 'small-phone',
      testMatch: /layout\.spec\.ts/,
      use: { ...devices['Galaxy S8'], locale: 'pl-PL' },
    },
  ],
  webServer: {
    command: `npx vite build --logLevel warn && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
