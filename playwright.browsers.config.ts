import { defineConfig, devices } from '@playwright/test';

// Smoke em outros motores: Firefox, WebKit (Safari) e WebKit como iPad com toque.
// A suíte principal (playwright.config.ts) continua só no Chromium.
export default defineConfig({
  testDir: './tests/browsers',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { headless: true, acceptDownloads: true, trace: 'retain-on-failure' },
  projects: [
    { name: 'firefox', use: { browserName: 'firefox', viewport: { width: 1440, height: 1000 } } },
    { name: 'webkit', use: { browserName: 'webkit', viewport: { width: 1440, height: 1000 } } },
    { name: 'ipad', use: { ...devices['iPad Pro 11 landscape'], browserName: 'webkit' } },
    {
      name: 'chromium-tablet',
      use: {
        browserName: 'chromium', viewport: { width: 1366, height: 1024 }, hasTouch: true, isMobile: false,
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    command: 'node scripts/serve-parity.mjs', url: 'http://127.0.0.1:4174/current/', reuseExistingServer: true,
  },
});
