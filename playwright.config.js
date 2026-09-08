import { defineConfig, devices } from '@playwright/test'

// These tests exercise the app against a running backend + Postgres.
// Start the backend first (see milkymart-backend/README), then: npm test
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // serial: each test resets the shared demo database
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
