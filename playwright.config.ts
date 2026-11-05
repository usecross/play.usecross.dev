import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Phase 0 smoke tests
 * 
 * Lightweight tests to verify:
 * - Shell loads without errors
 * - Service Worker registers
 * - Preview iframe is present
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: 'list',
  timeout: 180_000, // Includes Python/wheel downloads and the actual browser HTTP cycle
  
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
    },
  ],

  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
