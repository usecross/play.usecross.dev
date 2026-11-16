import { defineConfig } from '@playwright/test';
import config from './playwright.config';

export default defineConfig({
  ...config,
  use: { ...config.use, baseURL: 'http://127.0.0.1:8787' },
  // The built assets are the same in every browser; the dev suite covers WebKit.
  projects: config.projects!.filter(project => project.name === 'chromium'),
  webServer: {
    command: 'bun run build && bunx wrangler dev --local --ip 127.0.0.1 --port 8787',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
