// tests/e2e/specs/13-shared-backend.spec.js
// F13 — AC-13.1 (cross-profile visibility) and AC-13.2 (clearing site data doesn't lose
// feeds; the only localStorage keys the app ever writes are pumo.loggerName and
// pumo.namePromptDone).

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, seedQaLoggerName } = require('../helpers/app');
const { logButton, headline } = require('../helpers/selectors');
const { QA_LOGGED_BY, LIVE_URL } = require('../config');
const { devices } = require('@playwright/test');

test.describe('F13 — Shared backend (Supabase)', () => {
  test('AC-13.1 — a feed logged in context A shows in context B (separate profile) on next load', async ({
    browser,
  }) => {
    const contextB = await browser.newContext({ ...devices['iPhone 13'] }); // no shared storage with A
    const pageB = await contextB.newPage();

    // "Context A" logs a feed — done via real REST to isolate this AC from F3's own mechanics.
    const feed = await rest.insertFeed({ logged_by: QA_LOGGED_BY });

    await pageB.goto(`${LIVE_URL}/`, { waitUntil: 'load' });
    await expect(headline(pageB)).toContainText('just now', { timeout: 5000 });

    await rest.softDeleteById(feed.id);
    await contextB.close();
  });

  test('AC-13.2a — clearing all site data on A and reloading still shows every feed', async ({
    page,
    context,
  }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
    const feed = await rest.insertFeed({ logged_by: QA_LOGGED_BY });
    await gotoHome(page);
    await expect(headline(page)).toContainText('just now');

    // "Clearing all site data": localStorage/sessionStorage/cookies/caches for this origin.
    await page.evaluate(() => {
      try {
        window.localStorage.clear();
      } catch {}
      try {
        window.sessionStorage.clear();
      } catch {}
    });
    await context.clearCookies();

    await page.reload({ waitUntil: 'load' });
    await expect(headline(page)).toContainText('just now'); // the feed itself is server-side, unaffected

    await rest.softDeleteById(feed.id);
  });

  test('AC-13.2b — the only localStorage keys ever written are pumo.loggerName and pumo.namePromptDone', async ({
    page,
    context,
  }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
    await gotoHome(page);
    await expect(logButton(page)).toHaveText(/Log a feed|Checking…/, { timeout: 10000 });

    // Exercise a log + undo to make sure no feed-related data gets written anywhere.
    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    ).catch(() => null);
    await logButton(page).click();
    const res = await postPromise;
    if (res) {
      const row = (await res.json().catch(() => []))[0];
      if (row) await rest.softDeleteById(row.id).catch(() => {});
    }

    const keys = await page.evaluate(() => {
      try {
        return Object.keys(window.localStorage);
      } catch {
        return [];
      }
    });
    const unexpected = keys.filter((k) => k !== 'pumo.loggerName' && k !== 'pumo.namePromptDone');
    expect(unexpected, `unexpected localStorage keys: ${JSON.stringify(unexpected)}`).toEqual([]);
  });
});
