// tests/e2e/specs/01-app-load.spec.js
// AC-1.3 — LIVE_URL serves the app over HTTPS with no login or interstitial page, and
// LIVE_URL/build.txt matches the latest build.

'use strict';

const { test, expect } = require('../helpers/fixtures');
const { LIVE_URL, EXPECTED_BUILD_TXT } = require('../config');

test.describe('AC-1.3 — deploy is live, HTTPS, no gate, build.txt matches', () => {
  test('AC-1.3a — app loads over HTTPS with no login/interstitial', async ({ page }) => {
    if (!/^https:\/\//i.test(LIVE_URL)) {
      test.skip(true, `LIVE_URL (${LIVE_URL}) is not https:// yet — waiting for the real deploy.`);
    }
    const response = await page.goto(`${LIVE_URL}/`, { waitUntil: 'load' });
    expect(response, 'navigation should produce a response').not.toBeNull();
    expect(response.status(), 'expected 200 with no redirect to a login/auth page').toBe(200);
    expect(response.url().startsWith('https://')).toBeTruthy();

    // No login/interstitial: no password field, no "sign in" gate, and the app's own
    // content (per design.md §5, tab title "Pumo Feed Log") is what actually loaded.
    await expect(page).toHaveTitle('Pumo Feed Log');
    const passwordFields = await page.locator('input[type="password"]').count();
    expect(passwordFields, 'no login/password field should exist anywhere on load').toBe(0);
    const interstitialText = page.getByText(/sign in|log in|enter password|verify you are human/i);
    await expect(interstitialText).toHaveCount(0);
  });

  test('AC-1.3b — LIVE_URL/build.txt matches the latest build', async ({ request }) => {
    if (!/^https?:\/\//i.test(LIVE_URL)) test.skip(true, 'LIVE_URL not configured yet.');
    const res = await request.get(`${LIVE_URL}/build.txt`, { headers: { 'cache-control': 'no-cache' } });
    expect(res.ok(), `GET ${LIVE_URL}/build.txt should be 200`).toBeTruthy();
    const body = (await res.text()).trim();
    expect(body.length, 'build.txt should contain an ISO timestamp').toBeGreaterThan(0);
    // A loose ISO-8601 sanity check (contract doesn't pin an exact format beyond "ISO timestamp").
    expect(body).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

    if (EXPECTED_BUILD_TXT) {
      expect(body, 'build.txt should match the value the orchestrator handed off').toBe(
        EXPECTED_BUILD_TXT
      );
    } else {
      test.info().annotations.push({
        type: 'note',
        description:
          'No BUILD_TXT env var was supplied to compare against; recorded the live value only: ' + body,
      });
    }
  });
});
