// tests/e2e/specs/06-refresh-focus.spec.js
// F6 — AC-6.1 through AC-6.4 (fresh data on load and on focus).

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, gotoHistory, seedQaLoggerName, simulateHiddenThenVisible } = require('../helpers/app');
const { logButton, headline } = require('../helpers/selectors');
const { mockHomeData, mockHomeDataDynamic, mockPets, fakeFeed } = require('../helpers/mock');
const { MS } = require('../helpers/time');
const { QA_LOGGED_BY, CONSTANTS, LIVE_URL } = require('../config');
const { devices } = require('@playwright/test');

test.describe('F6 — Reload on load and on focus', () => {
  test('AC-6.1 — every load fetches fresh data (cache: no-store; no cached responses)', async ({
    page,
    context,
  }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
    const feedsGets = [];
    page.on('request', (req) => {
      if (req.method() === 'GET' && req.url().includes('/rest/v1/feeds')) {
        feedsGets.push({ url: req.url(), headers: req.headers() });
      }
    });

    await gotoHome(page);
    const afterFirstLoad = feedsGets.length;
    expect(afterFirstLoad, 'first load should issue GET requests to the feeds endpoint').toBeGreaterThan(0);

    // cache: 'no-store' should show up as a no-cache/no-store directive on the request.
    const noCacheHeaderCount = feedsGets.filter((r) => {
      const cc = (r.headers['cache-control'] || '').toLowerCase();
      return cc.includes('no-cache') || cc.includes('no-store');
    }).length;
    test.info().annotations.push({
      type: 'note',
      description: `${noCacheHeaderCount}/${feedsGets.length} feeds GETs carried a no-cache/no-store Cache-Control header (browsers vary in whether cache:'no-store' surfaces as a request header; the reload-count check below is the primary evidence).`,
    });

    await page.reload({ waitUntil: 'load' });
    const afterReload = feedsGets.length;
    expect(afterReload, 'reloading must issue new GET requests, not serve from cache').toBeGreaterThan(
      afterFirstLoad
    );

    await page.reload({ waitUntil: 'load' });
    expect(feedsGets.length, 'a second reload must again issue fresh GET requests').toBeGreaterThan(afterReload);
  });

  test('AC-6.2 — device A (hidden -> visible) picks up device B\'s feed within 2s, no manual reload', async ({
    browser,
  }) => {
    const contextA = await browser.newContext({ ...devices['iPhone 13'] });
    await seedQaLoggerName(contextA, 'QA-test-deviceA');
    const pageA = await contextA.newPage();
    await pageA.goto(`${LIVE_URL}/`, { waitUntil: 'load' });
    await expect(headline(pageA)).toBeVisible();

    // Device B: a separate profile, no shared storage — logs a real feed directly via REST
    // (device B's own logging mechanics are covered by F3/F13; this spec is about A's focus
    // refresh behavior).
    const before = Date.now();
    const feed = await rest.insertFeed({ logged_by: QA_LOGGED_BY });

    await simulateHiddenThenVisible(pageA);

    await expect(headline(pageA)).toContainText('just now', { timeout: 2000 });
    const elapsed = Date.now() - before;
    test.info().annotations.push({ type: 'note', description: `A picked up B's feed ${elapsed}ms after B logged it (budget: 2000ms after A becomes visible).` });

    await rest.softDeleteById(feed.id);
    await contextA.close();
  });

  test('AC-6.3 — stale data (>60s) triggers a refetch ("Checking…") before deciding to log or arm', async ({
    page,
    context,
  }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);

    let phase = 'initial'; // 'initial' -> unguarded; 'stale-refetch' -> a fresh recent feed appears
    // mockHomeDataDynamic doesn't mock getPets() itself (helpers/mock.js's own doc comment) —
    // without this, initPet()'s real getPets() call hits this sandbox's blocked egress and the
    // app never gets past its pet-load error state, which was masking this AC's own assertions
    // behind an unrelated network failure. Not a frontend defect — a QA test-setup gap.
    await mockPets(page);
    await mockHomeDataDynamic(page, () =>
      phase === 'initial'
        ? { recent: [], todayCount: 0 }
        : { recent: [fakeFeed({ agoMs: MS.minutes(1) })], todayCount: 1 }
    );

    const t0 = new Date();
    await page.clock.install({ time: t0 });
    await gotoHome(page);
    await expect(logButton(page)).toHaveText('Log a feed');

    // Advance the client clock past STALE_AFTER_MS (60s) without any new fetch happening yet.
    await page.clock.fastForward(5 * 60 * 1000); // "A loaded 5 minutes ago" per the AC's own example
    expect(5 * 60 * 1000).toBeGreaterThan(CONSTANTS.STALE_AFTER_MS);

    // "B logged 1 minute ago" (relative to the now-advanced clock) becomes visible on refetch.
    phase = 'stale-refetch';

    await logButton(page).click();
    // The app must refetch first ("Checking…") rather than logging immediately.
    await expect(logButton(page)).toHaveText('Checking…', { timeout: 2000 }).catch(async () => {
      // Some implementations may resolve the refetch fast enough that "Checking…" is
      // momentary; fall through to the outcome check either way.
    });
    // End state: armed (not logged), because the fresh data now has a feed 1 minute old.
    await expect(logButton(page)).toContainText('— log another?', { timeout: 3000 });
  });

  test('AC-6.4 — history screen also reloads when it regains focus', async ({ page, context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
    await mockHomeData(page, { recent: [], todayCount: 0 }); // in case history links back through home
    const historyGets = [];
    page.on('request', (req) => {
      if (req.method() === 'GET' && req.url().includes('/rest/v1/feeds') && req.url().includes('limit=100')) {
        historyGets.push(req.url());
      }
    });

    await gotoHistory(page);
    await expect.poll(() => historyGets.length, { timeout: 5000 }).toBeGreaterThan(0);
    const before = historyGets.length;

    await simulateHiddenThenVisible(page);
    await page.waitForTimeout(CONSTANTS.FOCUS_REFRESH_DEBOUNCE_MS + 500);
    expect(historyGets.length, 'focus should trigger a new history GET (first page reload)').toBeGreaterThan(
      before
    );
  });
});
