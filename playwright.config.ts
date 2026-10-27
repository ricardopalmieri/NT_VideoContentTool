import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/parity',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    browserName: 'chromium', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1,
    headless: true, acceptDownloads: true, trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'node scripts/serve-parity.mjs', url: 'http://127.0.0.1:4174/current/', reuseExistingServer: true,
  },
});
