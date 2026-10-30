import { defineConfig, devices } from '@playwright/test';

const PORT = 4100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'rm -f ../apps/server/data/e2e.db && pnpm --filter @autosdd/server start',
    url: `${BASE_URL}/api/overview`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      HOST: '127.0.0.1',
      PORT: String(PORT),
      DATABASE_PATH: './data/e2e.db',
      MOCK_DELAY_MS: '5',
      STEP_TIMEOUT_SECONDS: '30',
    },
  },
});
