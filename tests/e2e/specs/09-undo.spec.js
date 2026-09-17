// tests/e2e/specs/09-undo.spec.js
// F9 — AC-9.1 through AC-9.5 (undo notice right after logging).

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, seedQaLoggerName } = require('../helpers/app');
const { logButton, undoNotice, undoButton, undoFailedNotice } = require('../helpers/selectors');
const { mockHomeDataDynamic } = require('../helpers/mock');
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

test.describe('F9 — Undo right after logging', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  test('AC-9.1 — undo notice shows "Logged {time}" + Undo, lasts UNDO_WINDOW_MS (10s ± 0.5s)', async ({
    page,
  }) => {
    const stateBox = { state: { recent: [], todayCount: 0 } };
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
