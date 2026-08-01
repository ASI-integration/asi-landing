import { defineConfig, devices } from '@playwright/test';

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL as 'chrome' | 'msedge' | undefined;
const browserUse = browserChannel ? { channel: browserChannel } : {};

export default defineConfig({
  testDir: './tests',
  testMatch: 'dashboard-sidebar-scroll.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'dashboard-desktop',
      grep: /desktop nav scroll/,
      use: { ...devices['Desktop Chrome'], ...browserUse },
    },
    {
      name: 'dashboard-mobile',
      grep: /mobile drawer/,
      use: { ...devices['Pixel 5'], ...browserUse },
    },
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  outputDir: 'test-results/dashboard-sidebar-scroll',
});
