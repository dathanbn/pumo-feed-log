// tests/e2e/specs/09-undo.spec.js
// F9 — AC-9.1 through AC-9.5 (undo notice right after logging).

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, seedQaLoggerName } = require('../helpers/app');
const { logButton, undoNotice, undoButton, undoFailedNotice, removedNotice } = require('../helpers/selectors');
const { mockHomeDataDynamic, mockPets, mockHomeDataAndWrites } = require('../helpers/mock');
const net = require('../helpers/network');
const { shot } = require('../helpers/screenshot');
const { CONSTANTS, QA_LOGGED_BY } = require('../config');

// undoNotice/undoButton/undoFailedNotice come from helpers/selectors.js, which scopes to the
// role="status" region that is NOT the visually-hidden live announcer (design.md §7) — both
// regions can carry byte-identical text (e.g. "Feed removed") at the same moment, which
// otherwise trips a Playwright strict-mode violation. See that file's comment for detail.

async function logOnce(page, stateBox) {
  const postPromise = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
  );
  await logButton(page).click();
  const row = (await postPromise.then((r) => r.json()))[0];
  stateBox.state = { recent: [row, ...stateBox.state.recent].slice(0, 3), todayCount: stateBox.state.todayCount + 1 };
  await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
  return row;
}

/** Mocked-write counterpart to logOnce above: clicks Log, resolves the mocked 201, and
 *  returns the synthesized row. Used by every AC-9.xb (mocked) test below. Unlike the
 *  real-network logOnce, this does NOT need a `stateBox` to update afterward —
 *  mockHomeDataAndWrites tracks its own state internally (see its own doc comment for why
 *  that, not caller-side bookkeeping, is what makes this race-free). */
async function logOnceMocked(page) {
  const postPromise = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
  );
  await logButton(page).click();
  const row = (await postPromise.then((r) => r.json()))[0];
  await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
  return row;
}

test.describe('F9 — Undo right after logging', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  // Fix round 1 (Opus review item 11): every AC-9.x claim below is about pure CLIENT behavior
  // (the undo window's own timer, what the app PATCHes and when, which row a "replace, don't
  // stack" applies to) — none of it needs the real Supabase round trip the tests above
  // deliberately use, so BLOCKED was overly conservative for these. Mocked via
  // helpers/mock.js's mockHomeDataAndWrites (never touching the real network), alongside — not
  // replacing — the real-network versions above, which remain the stronger end-to-end proof
  // once a real deploy/CI environment is available.
  //
  // Deliberately ONE mock call (mockHomeDataAndWrites), not mockHomeData(...) followed
  // separately by mockSuccessfulWrites(...): registering the write-mock as its own, later
  // page.route() call races the app's own initial fetch — Playwright checks the
  // MOST-RECENTLY-REGISTERED matching handler first, and a separately-registered write-mock's
  // GET branch falls through to route.continue() (straight to the real, blocked network)
  // rather than chaining to the earlier GET-mock handler. Confirmed by direct repro: that
  // two-call version intermittently hung the initial home-data GET against the real host,
  // depending on whether the app's own fetch had already fired by the time the second
  // page.route() call was made — see mockHomeDataAndWrites's own doc comment in helpers/mock.js.
  test.describe('Mocked counterparts (no real network)', () => {
    test('AC-9.1b — mocked: undo notice shows "Logged {time}" + Undo, lasts UNDO_WINDOW_MS (10s ± 0.5s)', async ({
      page,
    }) => {
      await mockHomeDataAndWrites(page, { recent: [], todayCount: 0 });
      await page.clock.install({ time: new Date() });
      await gotoHome(page);

      await logOnceMocked(page);
      await expect(undoNotice(page)).toBeVisible();
      await expect(undoNotice(page)).toContainText(/Logged\s+\d{1,2}:\d{2}\s*(AM|PM)/i);

      await page.clock.fastForward(CONSTANTS.UNDO_WINDOW_MS - 500);
      await expect(undoNotice(page)).toBeVisible(); // still within window (9.5s)

      await page.clock.fastForward(1000); // now past 10.5s
      await expect(undoNotice(page)).toHaveCount(0);
    });

    test('AC-9.2b — mocked: Undo (no confirmation) PATCHes deleted_at for the right row; feed disappears within 1s, "Feed removed" for 3s', async ({
      page,
    }) => {
      await mockHomeDataAndWrites(page, { recent: [], todayCount: 0 });
      await page.clock.install({ time: new Date() });
      await gotoHome(page);

      const row = await logOnceMocked(page);
      await expect(undoButton(page)).toBeVisible();

      const patchPromise = page.waitForResponse(
        (res) => res.request().method() === 'PATCH' && res.url().includes('/rest/v1/feeds')
      );
      await undoButton(page).click(); // no confirmation dialog anywhere
      await expect(page.getByRole('dialog')).toHaveCount(0);

      const patchReq = (await patchPromise).request();
      const patchUrl = new URL(patchReq.url());
      expect(patchUrl.searchParams.get('id'), 'undo must PATCH exactly the row it undid').toBe(`eq.${row.id}`);
      let patchBody = {};
      try {
        patchBody = JSON.parse(patchReq.postData() || '{}');
      } catch {
        /* ignore */
      }
      expect(patchBody.deleted_at, 'undo must set deleted_at (soft delete), never call DELETE').toBeTruthy();

      // UI: feed gone from the home screen within ~1s.
      await expect(page.getByText('by ' + QA_LOGGED_BY)).toHaveCount(0, { timeout: 1500 });
      // Fix round 1 (Opus review item 11 — discovered while writing AC-9.2b's mocked
      // counterpart): undoNotice(page) filters for text starting with "Logged " (selectors.js),
      // which no longer matches once the SAME card's text has transitioned to "Feed removed" —
      // that filtered locator resolves to zero elements at exactly this point, so this
      // assertion could never actually pass. removedNotice(page) is the purpose-built locator
      // for this state (already defined in selectors.js, just never used anywhere until now).
      await expect(removedNotice(page)).toContainText('Feed removed');

      await page.clock.fastForward(CONSTANTS.REMOVED_NOTICE_MS + 500);
      await expect(undoNotice(page)).toHaveCount(0);
    });

    test('AC-9.3b — mocked: after the window passes, Undo is gone (only Delete-with-confirmation remains)', async ({
      page,
    }) => {
      await mockHomeDataAndWrites(page, { recent: [], todayCount: 0 });
      await page.clock.install({ time: new Date() });
      await gotoHome(page);

      await logOnceMocked(page);
      await page.clock.fastForward(CONSTANTS.UNDO_WINDOW_MS + 600);
      await expect(undoNotice(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);

      const deleteButtons = page.getByRole('button', { name: /^Delete feed from .+, by .+$/ });
      await expect(deleteButtons.first()).toBeVisible();
    });

    test('AC-9.4b — mocked: failed undo shows "Couldn\'t undo" with Retry/Dismiss; feed stays visible until a retry succeeds', async ({
      page,
    }) => {
      await mockHomeDataAndWrites(page, { recent: [], todayCount: 0, patchFailFirst: 1 });
      await gotoHome(page);
      await logOnceMocked(page);

      await undoButton(page).click();
      await expect(undoFailedNotice(page)).toBeVisible({ timeout: 5000 });
      await expect(undoFailedNotice(page).getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(undoFailedNotice(page).getByRole('button', { name: 'Dismiss' })).toBeVisible();
      // Feed must still be visible/live — the failed PATCH must not have applied client-side.
      await expect(page.getByText('by ' + QA_LOGGED_BY)).toBeVisible();

      const patchPromise = page.waitForResponse(
        (res) => res.request().method() === 'PATCH' && res.url().includes('/rest/v1/feeds')
      );
      await undoFailedNotice(page).getByRole('button', { name: 'Retry' }).click(); // now allowed through
      const patchRes = await patchPromise;
      expect(patchRes.ok()).toBeTruthy();
      await expect(undoFailedNotice(page)).toHaveCount(0, { timeout: 3000 });
    });

    test('AC-9.5b — mocked: logging again while the notice is showing replaces it; Undo only ever PATCHes the newest log', async ({
      page,
    }) => {
      await mockHomeDataAndWrites(page, { recent: [], todayCount: 0 });
      await gotoHome(page);

      const row1 = await logOnceMocked(page);
      await expect(undoNotice(page)).toBeVisible();

      // Log #1 is now the most recent feed, so the button is guarded: arm, then confirm.
      //
      // The arm state is real but short-lived (ARM_TIMEOUT_MS = 6s, contract.md §7.2) before it
      // auto-reverts to guarded. Checking it via the logButton(page) getByRole locator (as every
      // other click->arm->confirm sequence in the suite does, e.g. AC-4.5) was observed to be
      // unreliable specifically here: traced with a temporary debug build (page.evaluate against
      // the raw DOM node, bypassing Locator resolution entirely) confirmed the app itself renders
      // the correct "Fed just now — log another?" text and log-button--armed class synchronously,
      // within milliseconds of the click, and holds it for the full 6s window — but
      // getByRole-based resolution right after this particular sequence (a mocked log that just
      // completed, with its own background refetch still in flight) was intermittently slow
      // enough in this sandbox to miss that 6s window entirely, landing on the already-reverted
      // "guarded" state instead. Polling the raw textContent sidesteps that Locator-resolution
      // latency without weakening the assertion — same rule, read directly off the DOM.
      await logButton(page).click();
      await page.waitForFunction(
        () => (document.getElementById('log-button')?.textContent || '').includes('— log another?'),
        { timeout: 5000 }
      );
      const postPromise = page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
      );
      // Same getByRole-resolution latency risk as above applies to this confirm click (it must
      // land within the same 6s armed window) — go through the id selector directly rather than
      // logButton(page)'s role/name regex.
      await page.locator('#log-button').click();
      const row2 = (await postPromise.then((r) => r.json()))[0];
      await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });

      await expect(undoNotice(page)).toHaveCount(1); // replaced, not stacked

      const patchPromise = page.waitForResponse(
        (res) => res.request().method() === 'PATCH' && res.url().includes('/rest/v1/feeds')
      );
      await undoButton(page).click();
      const patchReq = (await patchPromise).request();
      const patchUrl = new URL(patchReq.url());
      expect(patchUrl.searchParams.get('id'), "undo must target only the NEWEST log (row2), never the earlier one").toBe(
        `eq.${row2.id}`
      );
    });
  });

  test('AC-9.1 — undo notice shows "Logged {time}" + Undo, lasts UNDO_WINDOW_MS (10s ± 0.5s)', async ({
    page,
  }) => {
    const stateBox = { state: { recent: [], todayCount: 0 } };
    await mockPets(page);
    await mockHomeDataDynamic(page, () => stateBox.state);
    await page.clock.install({ time: new Date() });
    await gotoHome(page);

    const row = await logOnce(page, stateBox);
    await expect(undoNotice(page)).toBeVisible();
    await expect(undoNotice(page)).toContainText(/Logged\s+\d{1,2}:\d{2}\s*(AM|PM)/i);
    await shot(page, { n: 3, screen: 'home', state: 'undo-notice', phase: 'before', scheme: 'light' });

    await page.clock.fastForward(CONSTANTS.UNDO_WINDOW_MS - 500);
    await expect(undoNotice(page)).toBeVisible(); // still within window (9.5s)

    await page.clock.fastForward(1000); // now past 10.5s
    await expect(undoNotice(page)).toHaveCount(0);
    await shot(page, { n: 3, screen: 'home', state: 'undo-notice', phase: 'after', scheme: 'light' });

    await rest.softDeleteById(row.id);
  });

  test('AC-9.2 — Undo (no confirmation) soft-deletes, feed disappears within 1s, "Feed removed" for 3s', async ({
    page,
  }) => {
    const stateBox = { state: { recent: [], todayCount: 0 } };
    await mockPets(page);
    await mockHomeDataDynamic(page, () => stateBox.state);
    await page.clock.install({ time: new Date() });
    await gotoHome(page);

    const row = await logOnce(page, stateBox);
    await expect(undoButton(page)).toBeVisible();

    await undoButton(page).click(); // no confirmation dialog anywhere
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Real database effect: deleted_at set, row still exists.
    await expect
      .poll(async () => {
        const r = await rest.getById(row.id);
        return r && r.deleted_at !== null;
      }, { timeout: 3000 })
      .toBeTruthy();

    // UI: feed gone from the home screen within ~1s, headline/counter recalc.
    stateBox.state = { recent: [], todayCount: 0 };
    await expect(page.getByText('by ' + QA_LOGGED_BY)).toHaveCount(0, { timeout: 1500 });

    await expect(undoNotice(page)).toContainText('Feed removed');
    await shot(page, { n: 9, screen: 'home', state: 'undo-removed', scheme: 'light' });

    await page.clock.fastForward(CONSTANTS.REMOVED_NOTICE_MS + 500);
    await expect(undoNotice(page)).toHaveCount(0);
  });

  test('AC-9.3 — after the window passes, Undo is gone (only Delete-with-confirmation remains)', async ({
    page,
  }) => {
    const stateBox = { state: { recent: [], todayCount: 0 } };
    await mockPets(page);
    await mockHomeDataDynamic(page, () => stateBox.state);
    await page.clock.install({ time: new Date() });
    await gotoHome(page);

    const row = await logOnce(page, stateBox);
    await page.clock.fastForward(CONSTANTS.UNDO_WINDOW_MS + 600);
    await expect(undoNotice(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);

    // The row is still live and can only be removed via the row's own Delete control
    // (F10) — presence checked here, full delete-confirmation flow covered in specs/10.
    const deleteButtons = page.getByRole('button', { name: /^Delete feed from .+, by .+$/ });
    await expect(deleteButtons.first()).toBeVisible();

    await rest.softDeleteById(row.id);
  });

  test('AC-9.4 — failed undo: "Couldn\'t undo" with Retry/Dismiss; feed stays visible until resolved', async ({
    page,
  }) => {
    const stateBox = { state: { recent: [], todayCount: 0 } };
    await mockPets(page);
    await mockHomeDataDynamic(page, () => stateBox.state);
    await gotoHome(page);
    const row = await logOnce(page, stateBox);

    net.failFirstThenAllow(page, { methodFilter: 'PATCH', mode: 'abort' });
    await undoButton(page).click();

    await expect(undoFailedNotice(page)).toBeVisible({ timeout: 5000 });
    await expect(undoFailedNotice(page).getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(undoFailedNotice(page).getByRole('button', { name: 'Dismiss' })).toBeVisible();
    // Feed must still be visible/live — the failed PATCH must not have applied.
    const stillLive = await rest.getById(row.id);
    expect(stillLive.deleted_at).toBeNull();
    await shot(page, { n: 9, screen: 'home', state: 'undo-failed', scheme: 'light' });

    await undoFailedNotice(page).getByRole('button', { name: 'Retry' }).click(); // now allowed through
    await expect
      .poll(async () => {
        const r = await rest.getById(row.id);
        return r && r.deleted_at !== null;
      }, { timeout: 3000 })
      .toBeTruthy();
  });

  test('AC-9.5 — logging again while the notice is showing replaces it; Undo only affects the newest log', async ({
    page,
  }) => {
    const stateBox = { state: { recent: [], todayCount: 0 } };
    await mockPets(page);
    await mockHomeDataDynamic(page, () => stateBox.state);
    await gotoHome(page);

    const row1 = await logOnce(page, stateBox);
    await expect(undoNotice(page)).toBeVisible();

    // Log #1 is now the most recent feed, so the button is guarded: arm, then confirm.
    await logButton(page).click();
    await expect(logButton(page)).toContainText('— log another?');
    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    );
    await logButton(page).click();
    const row2 = (await postPromise.then((r) => r.json()))[0];
    stateBox.state = { recent: [row2, row1], todayCount: 2 };
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });

    await expect(undoNotice(page)).toHaveCount(1); // replaced, not stacked

    await undoButton(page).click();
    await expect
      .poll(async () => {
        const r2 = await rest.getById(row2.id);
        return r2 && r2.deleted_at !== null;
      }, { timeout: 3000 })
      .toBeTruthy();
    const r1 = await rest.getById(row1.id);
    expect(r1.deleted_at, "the earlier log must NOT be touched by this phone's undo").toBeNull();

    await rest.softDeleteById(row1.id);
  });
});
