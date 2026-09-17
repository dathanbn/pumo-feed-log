// tests/e2e/specs/03-logging.spec.js
// F3 — AC-3.1 (one tap, exactly one row, no dialog) and AC-3.2 (5-trial timing check).
//
// Both taps go through the REAL Supabase project (no route interception on POST), so the
// row-count assertions use a before/after delta of live QA-test rows rather than assuming
// the table is otherwise empty (see helpers/mock.js header for the general rationale).

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, seedQaLoggerName } = require('../helpers/app');
const { logButton } = require('../helpers/selectors');
const { mockHomeData } = require('../helpers/mock');
const { shot } = require('../helpers/screenshot');
const { QA_LOGGED_BY } = require('../config');

/** Sets up a page with an unguarded ("ready") home state and a QA-test logger name. */
async function gotoReadyHome(page, context) {
  await seedQaLoggerName(context, QA_LOGGED_BY);
  await mockHomeData(page, { recent: [], todayCount: 0 }); // no recent feed, 0 today -> unguarded
  await gotoHome(page);
  await expect(logButton(page)).toHaveText('Log a feed');
}

test.describe('F3 — One-tap logging', () => {
  test('AC-3.1 — one tap on an unguarded button creates exactly one row, no dialog/extra step', async ({
    page,
    context,
  }) => {
    await gotoReadyHome(page, context);

    const before = (await rest.listLiveQaTestRows()).length;

    // No dialog/modal should exist before or ever appear because of the tap.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await logButton(page).click();
    // No native or ARIA dialog opens at any point during the flow.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 2000 });

    const after = (await rest.listLiveQaTestRows()).length;
    expect(after - before, 'exactly one new QA-test row should exist after one tap').toBe(1);
  });

  test('AC-3.2 — 5 trials in a row, each reaches "Logged" within 1s (normal connection)', async ({
    page,
    context,
  }) => {
    const timings = [];
    const createdIds = [];

    for (let trial = 1; trial <= 5; trial++) {
      await gotoReadyHome(page, context);

      // Capture the id the app generates so we can look it up / clean it up afterward,
      // without adding our own latency to the measured path.
      const postPromise = page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds'),
        { timeout: 5000 }
      );

      const start = Date.now();
      await logButton(page).click();
      await expect(logButton(page)).toHaveText(/Logged/, { timeout: 1000 });
      const elapsed = Date.now() - start;
      timings.push(elapsed);

      const res = await postPromise;
      const body = await res.json().catch(() => null);
      if (Array.isArray(body) && body[0] && body[0].id) createdIds.push(body[0].id);

      expect(elapsed, `trial ${trial}: click-to-"Logged" should be <= 1000ms, was ${elapsed}ms`).toBeLessThanOrEqual(
        1000
      );
    }

    test.info().annotations.push({
      type: 'AC-3.2 timings (ms)',
      description: JSON.stringify(timings),
    });

    for (const id of createdIds) {
      await rest.softDeleteById(id).catch(() => {});
    }
  });

  test('screenshot — logged state + undo notice', async ({ page, context }) => {
    await gotoReadyHome(page, context);
    await logButton(page).click();
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 2000 });
    await shot(page, { n: 3, screen: 'home', state: 'logged-undo-notice', scheme: 'light' });
  });
});
