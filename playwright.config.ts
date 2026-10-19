import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// The cloud dev container ships Chromium at a fixed path; locally Playwright downloads its own.
const preinstalled = ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p))

// Parallel checkouts each run their own preview server: E2E_PORT=4174 npx playwright test
const port = process.env.E2E_PORT ?? '4173'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    ...devices['Pixel 7'],
    ...(preinstalled ? { launchOptions: { executablePath: preinstalled } } : {}),
  },
  webServer: {
    command: `npm run preview -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
