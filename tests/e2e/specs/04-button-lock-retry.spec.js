// tests/e2e/specs/04-button-lock-retry.spec.js
// F4 — AC-4.1 through AC-4.5 (button lock while saving; failed saves can be retried).

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, seedQaLoggerName } = require('../helpers/app');
const { logButton, undoNoticeRegion } = require('../helpers/selectors');
const { mockHomeData, mockSuccessfulWrites, mockLostResponseThenConflict, countFeedRequests, fakeFeed } = require('../helpers/mock');
const net = require('../helpers/network');
const { shot } = require('../helpers/screenshot');
const { MS } = require('../helpers/time');
const { QA_LOGGED_BY, CONSTANTS } = require('../config');

async function gotoReadyHome(page, context) {
  await seedQaLoggerName(context, QA_LOGGED_BY);
  await mockHomeData(page, { recent: [], todayCount: 0 });
  await gotoHome(page);
  await expect(logButton(page)).toHaveText('Log a feed');
}

/** Guarded (recent) home: last feed 1h55m ago -> first tap arms, second tap saves. */
async function gotoGuardedHome(page, context) {
  await seedQaLoggerName(context, QA_LOGGED_BY);
  await mockHomeData(page, {
    recent: [fakeFeed({ agoMs: MS.hours(1) + MS.minutes(55) })],
    todayCount: 1,
  });
  await gotoHome(page);
  await expect(logButton(page)).toHaveText('Log a feed'); // guarded style, same label
}

async function captureFirstPostId(page) {
  return new Promise((resolve) => {
    page.on('request', function handler(req) {
      if (req.method() === 'POST' && req.url().includes('/rest/v1/feeds')) {
        page.off('request', handler);
        try {
          resolve(JSON.parse(req.postData() || '{}').id);
        } catch {
          resolve(undefined);
        }
      }
    });
  });
}

test.describe('F4 — Button locks while saving; failed saves retry', () => {
  test('AC-4.1 — disabled + "Saving…" while pending; 5 rapid taps under 3s latency create exactly 1 row', async ({
    page,
    context,
  }) => {
    await gotoReadyHome(page, context);
    await net.addLatency(page, 3000, { methodFilter: 'POST' });

    const before = (await rest.listLiveQaTestRows()).length;
    const box = await logButton(page).boundingBox();
    expect(box).not.toBeNull();

    for (let i = 0; i < 5; i++) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(logButton(page)).toHaveText('Saving…');
    await expect(logButton(page)).toBeDisabled();
    await shot(page, { n: 4, screen: 'home', state: 'saving', scheme: 'light' });

    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 6000 });
    const after = (await rest.listLiveQaTestRows()).length;
    expect(after - before, '5 rapid taps while disabled should still create exactly 1 row').toBe(1);
  });

  // Fix round 1 (Opus review item 11): AC-4.1/4.2/4.4's claims are about pure CLIENT behavior
  // (a request count, UI text before/after a response resolves, retry-reuses-id handling) —
  // none of them need a real Supabase round trip, only a plausible-shaped POST response, so
  // BLOCKED (this sandbox can't reach *.supabase.co) was overly conservative for these three.
  // Mocked below via helpers/mock.js's mockSuccessfulWrites/mockLostResponseThenConflict,
  // alongside (not replacing) the real-network versions above, which remain the stronger proof
  // once a real deploy/CI environment is available.
  test('AC-4.1b — mocked: disabled + "Saving…" while pending; 5 rapid taps under 3s latency send exactly 1 POST', async ({
    page,
    context,
  }) => {
    await gotoReadyHome(page, context);
    await mockSuccessfulWrites(page, { postDelayMs: 3000 });

    const posts = countFeedRequests(page, 'POST');
    const box = await logButton(page).boundingBox();
    expect(box).not.toBeNull();

    for (let i = 0; i < 5; i++) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await expect(logButton(page)).toHaveText('Saving…');
    await expect(logButton(page)).toBeDisabled();

    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 6000 });
    expect(posts.count, '5 rapid taps while disabled should still send exactly 1 POST').toBe(1);
  });

  test('AC-4.2b — mocked: "Logged" never appears while the mocked POST is still pending', async ({ page, context }) => {
    await gotoReadyHome(page, context);
    await mockSuccessfulWrites(page, { postDelayMs: 2500 });
    await logButton(page).click();

    // Poll for ~2s (less than the 2.5s latency) and confirm "Logged" never shows up.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      await expect(logButton(page)).not.toHaveText(/Logged/);
      await page.waitForTimeout(200);
    }
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 }); // then it does, once resolved
  });

  test('AC-4.4b — mocked: lost response then 409 conflict — retry reuses the same id, only one id ever POSTed', async ({
    page,
    context,
  }) => {
    await gotoReadyHome(page, context);
    await mockLostResponseThenConflict(page);

    const postedIds = new Set();
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/rest/v1/feeds')) {
        try {
          postedIds.add(JSON.parse(req.postData() || '{}').id);
        } catch {
          /* ignore */
        }
      }
    });

    await logButton(page).click();
    await expect(logButton(page)).toHaveText('Not saved, tap to retry', { timeout: 12000 });
    expect(postedIds.size, 'the first attempt should have posted exactly one id').toBe(1);

    await logButton(page).click(); // retry — same id, 409/23505 -> GET-by-id path -> success
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 5000 });
    expect(postedIds.size, 'the retry must reuse the SAME id, never mint a new one').toBe(1);
  });

  test('AC-4.2 — "Logged" never appears while the POST is still pending', async ({ page, context }) => {
    await gotoReadyHome(page, context);
    await net.addLatency(page, 2500, { methodFilter: 'POST' });
    await logButton(page).click();

    // Poll for ~2s (less than the 2.5s latency) and confirm "Logged" never shows up.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      await expect(logButton(page)).not.toHaveText(/Logged/);
      await page.waitForTimeout(200);
    }
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 }); // then it does, once resolved
  });

  test('AC-4.3a — offline: not-saved, no row, no undo; retry after reconnect succeeds', async ({
    page,
    context,
  }) => {
    await gotoReadyHome(page, context);
    const before = (await rest.listLiveQaTestRows()).length;

    await context.setOffline(true);
    await logButton(page).click();
    await expect(logButton(page)).toHaveText('Not saved, tap to retry', { timeout: 12000 });
    await expect(undoNoticeRegion(page).filter({ hasText: /^Logged / })).toHaveCount(0);
    await shot(page, { n: 5, screen: 'home', state: 'not-saved', scheme: 'light' });

    const midCount = (await rest.listLiveQaTestRows()).length;
    expect(midCount - before, 'no row should be created while offline').toBe(0);

    await context.setOffline(false);
    await logButton(page).click();
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
    const after = (await rest.listLiveQaTestRows()).length;
    expect(after - before, 'retry after reconnect should create exactly one row').toBe(1);
  });

  test('AC-4.3b — aborted request: not-saved; retry (request now allowed) succeeds', async ({
    page,
    context,
  }) => {
    await gotoReadyHome(page, context);
    const before = (await rest.listLiveQaTestRows()).length;
    net.failFirstThenAllow(page, { methodFilter: 'POST', mode: 'abort' });

    await logButton(page).click();
    await expect(logButton(page)).toHaveText('Not saved, tap to retry', { timeout: 12000 });

    await logButton(page).click(); // retry — route now passes through
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
    const after = (await rest.listLiveQaTestRows()).length;
    expect(after - before, 'exactly one row after the retry succeeds').toBe(1);
  });

  test('AC-4.3c — HTTP 5xx: not-saved; retry succeeds once the fault clears', async ({ page, context }) => {
    await gotoReadyHome(page, context);
    const before = (await rest.listLiveQaTestRows()).length;
    net.failFirstThenAllow(page, { methodFilter: 'POST', mode: '5xx', status: 503 });

    await logButton(page).click();
    await expect(logButton(page)).toHaveText('Not saved, tap to retry', { timeout: 12000 });

    await logButton(page).click();
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
    const after = (await rest.listLiveQaTestRows()).length;
    expect(after - before).toBe(1);
  });

  test('AC-4.3d — timeout: no response within REQUEST_TIMEOUT_MS -> not-saved', async ({ page, context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await page.clock.install({ time: new Date() });
    await gotoHome(page);
    await expect(logButton(page)).toHaveText('Log a feed');

    await net.neverRespond(page, { methodFilter: 'POST' });
    await logButton(page).click();
    await expect(logButton(page)).toHaveText('Saving…');

    await page.clock.fastForward(CONSTANTS.REQUEST_TIMEOUT_MS + 500);
    await expect(logButton(page)).toHaveText('Not saved, tap to retry', { timeout: 3000 });
  });

  test('AC-4.4 — lost response: retry reuses the same id, leaving exactly one row', async ({
    page,
    context,
  }) => {
    await gotoReadyHome(page, context);
    const before = (await rest.listLiveQaTestRows()).length;

    const idPromise = captureFirstPostId(page);
    net.lostResponseOnFirstMatch(page, undefined, 'POST');

    await logButton(page).click();
    await expect(logButton(page)).toHaveText('Not saved, tap to retry', { timeout: 12000 });
    const firstId = await idPromise;
    expect(firstId, 'should have captured the id from the first POST body').toBeTruthy();

    // The row DID reach the database even though the client saw no response.
    const rowAfterLostResponse = await rest.getById(firstId);
    expect(rowAfterLostResponse, 'the lost-response POST should have actually inserted a row').not.toBeNull();

    await logButton(page).click(); // retry — same id, expect 409 treated as success
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });

    const after = (await rest.listLiveQaTestRows()).length;
    expect(after - before, 'retry must not create a second row').toBe(1);
  });

  test('AC-4.5 — a retry after a confirmed (armed) save is not re-guarded', async ({ page, context }) => {
    await gotoGuardedHome(page, context);
    net.failFirstThenAllow(page, { methodFilter: 'POST', mode: 'abort' });

    await logButton(page).click(); // arm
    await expect(logButton(page)).toContainText('— log another?');
    await logButton(page).click(); // confirm -> save -> fails
    await expect(logButton(page)).toHaveText('Not saved, tap to retry', { timeout: 12000 });

    await logButton(page).click(); // retry: must go straight to saving/logged, NOT back to armed
    await expect(logButton(page)).not.toContainText('— log another?');
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
  });
});
