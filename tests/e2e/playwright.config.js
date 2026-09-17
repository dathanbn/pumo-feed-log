// tests/e2e/playwright.config.js
// Per tasks.md §2 "Setup": iPhone 13 (390x844) for most tests, light+dark color schemes,
// timezoneId America/Los_Angeles, and Chromium launched from the machine-installed browser
// (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers; `playwright install` is never run here).

'use strict';

const { defineConfig, devices } = require('@playwright/test');
const { CHROMIUM_EXECUTABLE_PATH, PRIMARY_TIMEZONE, LIVE_URL } = require('./config');

module.exports = defineConfig({
  testDir: './specs',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // shared Supabase test data (QA-test rows) — keep scenarios serialized
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'off', // specs take their own named screenshots into tests/screenshots/
    video: 'off',
    launchOptions: {
      executablePath: CHROMIUM_EXECUTABLE_PATH,
      // This suite frequently runs as root (containers/CI); Chromium's sandbox refuses to
      // start as root without this flag ("Running as root without --no-sandbox is not
      // supported"). Harmless when not running as root.
      args: ['--no-sandbox'],
    },
    timezoneId: PRIMARY_TIMEZONE,
    baseURL: LIVE_URL,
  },
  projects: [
    {
      name: 'rest-direct',
      // No browser needed at all — pure REST checks (AC-5.2, AC-11.1, AC-11.2). Kept as its
      // own project so it can run standalone before the frontend exists.
      testMatch: /00-rest-direct\.spec\.js/,
      use: {},
    },
    {
      name: 'source-checks',
      // No browser needed — reads frontend/js/*.js directly (AC-11.3 grep).
      testMatch: /11-soft-delete-source\.spec\.js/,
      use: {},
    },
    {
      name: 'mobile-light',
      testIgnore: [/00-rest-direct\.spec\.js/, /11-soft-delete-source\.spec\.js/],
      use: {
        ...devices['iPhone 13'],
        // devices['iPhone 13'] sets defaultBrowserType: 'webkit', which isn't installed in
        // this environment (only Chromium is, per orchestrator setup) — force Chromium while
        // keeping the rest of the device's emulation (viewport, UA, isMobile, hasTouch, DSF).
        defaultBrowserType: 'chromium',
        browserName: 'chromium',
        colorScheme: 'light',
        timezoneId: PRIMARY_TIMEZONE,
      },
    },
    {
      name: 'mobile-dark',
      testIgnore: [/00-rest-direct\.spec\.js/, /11-soft-delete-source\.spec\.js/],
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        browserName: 'chromium',
        colorScheme: 'dark',
        timezoneId: PRIMARY_TIMEZONE,
      },
    },
    {
      name: 'desktop-light',
      testIgnore: [/00-rest-direct\.spec\.js/, /11-soft-delete-source\.spec\.js/],
      use: {
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light',
        timezoneId: PRIMARY_TIMEZONE,
      },
    },
  ],
});
