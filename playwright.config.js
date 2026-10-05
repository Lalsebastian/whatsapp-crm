import { defineConfig, devices } from '@playwright/test'

// Browser end-to-end tests for the Owner, Agent and Technician consoles.
//
// The app runs from the Vite dev server (role switching is a development-only
// affordance) and points at a fake Supabase URL. Every request to it is
// answered by e2e/support/fakeSupabase.js, so these tests are deterministic
// and can never read or write a real project, whatever .env.local contains:
// variables set here take precedence over .env files.
const PORT = 4317
const FAKE_SUPABASE_URL = 'http://127.0.0.1:54329'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // One Vite dev server serves every browser; more workers than this starve
  // it on a typical laptop or CI runner and make timings flaky.
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The dev server compiles views on first request; allow for a cold start.
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    timezoneId: 'Asia/Dubai',
    locale: 'en-GB',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.js/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.js/ },
  ],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: FAKE_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'e2e-publishable-key',
      VITE_SUPABASE_ANON_KEY: 'e2e-publishable-key',
      VITE_CHATBOT_API_BASE_URL: 'http://127.0.0.1:54330',
    },
  },
})
