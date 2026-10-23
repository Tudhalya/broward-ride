'use strict';

const { defineConfig, devices } = require('@playwright/test');

// Off the default 8080 so tests can run while `npm run dev` is up
const PORT = 8091;

module.exports = defineConfig({
  testDir:    './tests',
  forbidOnly: !!process.env.CI,
  reporter:   process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace:   'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    { name: 'android',  use: { ...devices['Pixel 7'] } },
    { name: 'iphone',   use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command:             'node server.js',
    url:                 `http://localhost:${PORT}/api/health`,
    env:                 { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
  },
});
