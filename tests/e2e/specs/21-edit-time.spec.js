// tests/e2e/specs/21-edit-time.spec.js
// F21 — Editing a feed's logged time (v1.2). AC-21.1 through AC-21.8.
//
// design.md §3.6b is the full behavior spec; contract.md §6.H (updateFeedTime) and §7.11
// (computeEditedTimestamp) are the data-layer contract. This suite covers what's provable via
// mocked routes and pure client behavior — the DB-level future-time rejection (23514) and the
// pet_id/logged_by "can't edit" guarantees are ALSO confirmed directly against the real
// database via specs/00-rest-direct.spec.js's AC-5.2c/AC-21.8a/AC-21.8b and
// tests/e2e/evidence/ac-21.4-21.8-sql-verification.json (this sandbox's network egress can't
// reach *.supabase.co from a real Playwright browser session, so a live end-to-end edit cycle
// through the UI is BLOCKED here — see qa-report.md).
//
// A note on the "target deleted concurrently" scenario (AC-21.6/S19), per the Frontend agent's
// own flag: the row's "This feed was deleted." message does NOT trigger a synchronous
// full re-render (that would remove the message before anyone could see it) — it fires the
// same background refresh the page already uses elsewhere, so the row disappears on that
// refresh's next tick, not instantly. Tests below assert the message actually appears, and
// that the row is eventually dropped once the background refresh lands — not that both happen
// in the same tick.

'use strict';

const { test, expect } = require('../helpers/fixtures');
const { gotoHome, gotoHistory, seedQaLoggerName } = require('../helpers/app');
const {
  rowEditButton,
  rowDeleteButton,
  editTimeInput,
  editSaveButton,
  editCancelButton,
  editFutureRejectedText,
  editFailedText,
  editRetryButton,
  editDeletedText,
  confirmCancelButton,
  headline,
  counterPill,
  recentRows,
  dayHeading,
  heatmapCellByLabel,
} = require('../helpers/selectors');
const { mockHomeData, mockHomeDataAndWrites, mockHistoryFirstPageAndWrites, fakeFeed, countFeedRequests } = require('../helpers/mock');
const { assertTapTarget } = require('../helpers/a11y');
const { shot } = require('../helpers/screenshot');
const { MS } = require('../helpers/time');
const { heatmapCellAriaLabelExpected } = require('../helpers/format');
const { QA_LOGGED_BY, CONSTANTS } = require('../config');

// A fixed "now" for every deterministic scenario below, in the suite's primary timezone
// (America/Los_Angeles) — Wednesday 2026-09-16, 8:00 PM. Picked well after 3 AM (so "Today"
// unambiguously means this calendar date) and well before midnight (so no test here risks
// straddling its OWN "now" across a day boundary mid-run).
const NOW = new Date(2026, 8, 16, 20, 0, 0, 0);

// Builds a feed's `created_at` the way the REAL database always does: with non-zero
// seconds/milliseconds. A real Supabase `created_at` is never exactly HH:MM:00.000 — using a
// clean, whole-minute Date (as an earlier version of this file did throughout) silently masked
// a real bug: `<input type="time">` only ever carries HH:MM, so a feed's *displayed* time
// could equal the input's unchanged value while the underlying timestamps still differed at
// the seconds/ms level, and a naive Save could rewind those seconds to :00 even when nothing
// user-visible had changed. `ui.js`'s `confirmEdit` now guards against exactly this (a
// minute-granularity comparison ahead of `computeEditedTimestamp`'s own ms-exact one — see that
// function's own comment) — every ORIGINAL feed timestamp built below uses this helper instead
// of a bare `new Date(...)` so that guard is actually exercised by real-shaped data, not
// accidentally bypassed by an artificially clean fixture. (Timestamps representing the
// EXPECTED result of an edit are deliberately NOT built with this helper — contract.md §7.11
// always constructs the edited candidate at exactly HH:MM:00.000, since that's all the time
// input can express, so asserting against a bare `new Date(..., 0, 0)` there is correct, not
// an oversight.)
function realisticFeedIso(hour, minute, day = 16) {
  return new Date(2026, 8, day, hour, minute, 17, 342).toISOString();
}

test.describe('F21 — Edit a feed\'s logged time', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  // -----------------------------------------------------------------------------------------
  // AC-21.1 — Edit icon next to Delete, on both home's recent list and history's day-grouped
  // list, visible whenever the row is in its normal state.
  // -----------------------------------------------------------------------------------------

  test('AC-21.1a — home: every recent-list row shows an Edit icon next to its Delete icon', async ({ page }) => {
    await mockHomeData(page, {
      recent: [fakeFeed({ agoMs: MS.minutes(30), loggedBy: 'Sam' }), fakeFeed({ agoMs: MS.hours(3), loggedBy: 'Alex' })],
      todayCount: 2,
    });
    await gotoHome(page);
    await expect(rowEditButton(page)).toHaveCount(2);
    await expect(rowDeleteButton(page)).toHaveCount(2);
  });

  test('AC-21.1b — history: every day-grouped row shows an Edit icon next to its Delete icon', async ({ page }) => {
    await mockHistoryFirstPageAndWrites(page, [
      fakeFeed({ agoMs: MS.minutes(30), loggedBy: 'Sam', petSlug: 'pumo' }),
      fakeFeed({ agoMs: MS.hours(3), loggedBy: 'Alex', petSlug: 'pumo' }),
    ]);
    await gotoHistory(page, 'pumo');
    await expect(rowEditButton(page)).toHaveCount(2);
    await expect(rowDeleteButton(page)).toHaveCount(2);
  });

  // -----------------------------------------------------------------------------------------
  // AC-21.2 — Tapping Edit opens the inline time editor, pre-filled with the feed's current
  // local time; Save/Cancel; shares the single "one open row at a time" rule with Delete
  // (AC-10.5).
  // -----------------------------------------------------------------------------------------

  test('AC-21.2a — tapping Edit opens an inline <input type="time"> pre-filled with the feed\'s current local time, plus Save/Cancel', async ({
    page,
  }) => {
    const feed = { id: 'edit-1', created_at: realisticFeedIso(7, 42), logged_by: 'Sam' };
    await page.clock.install({ time: NOW });
    await mockHomeDataAndWrites(page, { recent: [feed], todayCount: 1 });
    await gotoHome(page);

    await rowEditButton(page).click();
    const row = page.locator('.row--edit-open');
    await expect(row).toBeVisible();
    const input = editTimeInput(row);
    await expect(input).toHaveValue('07:42');
    await expect(editSaveButton(row)).toBeVisible();
    await expect(editCancelButton(row)).toBeVisible();
    // Focus moves to the time input on open (design.md §3.6b, same pattern as delete's own
    // "focus moves to Cancel").
    await expect(input).toBeFocused();
    // tasks.md §2's minimum screenshot set: "the edit-time flow open (input pre-filled) ... on
    // a home row" (see AC-21.3b for the history-row counterpart).
    await shot(page, { n: 21, screen: 'home', state: 'edit-open', scheme: 'light' });
  });

  test('AC-21.2b — opening Edit on one row closes another row\'s open Edit or Delete confirmation, and vice versa (shared AC-10.5 rule)', async ({
    page,
  }) => {
    const feedA = { id: 'edit-a', created_at: realisticFeedIso(7, 42), logged_by: 'Sam' };
    const feedB = { id: 'edit-b', created_at: realisticFeedIso(10, 0), logged_by: 'Alex' };
    await page.clock.install({ time: NOW });
    await mockHomeDataAndWrites(page, { recent: [feedB, feedA], todayCount: 2 });
    await gotoHome(page);

    // Open Delete-confirm on row A, then Edit on row B — A's confirm must close.
    const rows = recentRows(page);
    await rowDeleteButton(page).nth(1).click(); // row A (7:42 AM) is the 2nd row, newest-first
    await expect(confirmCancelButton(rows.nth(1))).toBeVisible();
    await rowEditButton(page).first().click(); // row B (10:00 AM)
    await expect(confirmCancelButton(rows.nth(1))).toHaveCount(0); // A's delete-confirm closed
    await expect(editTimeInput(rows.nth(0))).toBeVisible(); // B's editor is now open

    // Open Edit on row A while B's editor is still open — B's editor must close. Only ONE
    // row's own Edit button is ever rendered at a time here: B's Edit icon disappears while
    // B is 'editing' (ui.js render() only shows Edit/Delete in the row's 'normal' state), so
    // row A's is now the only match — `.first()`, not a stale `.nth(1)` index into a set that
    // has since shrunk to size 1.
    await rowEditButton(page).first().click();
    await expect(editTimeInput(rows.nth(1))).toBeVisible();
    await expect(rows.nth(0).locator('.row--edit-open')).toHaveCount(0); // B's editor closed
  });

  // -----------------------------------------------------------------------------------------
  // AC-21.3 — Saving a valid time updates created_at on the ORIGINAL calendar date; the row,
  // day-grouping, "n of 4 today" counter and (history) heatmap all reflect it within 1s.
  // -----------------------------------------------------------------------------------------

  test('AC-21.3a — home: saving a new time updates the row and the headline\'s "Last fed" relative time, PATCH carries the right created_at', async ({
    page,
  }) => {
    const originalIso = realisticFeedIso(7, 42);
    const feed = { id: 'edit-home-1', created_at: originalIso, logged_by: 'Sam' };
    await page.clock.install({ time: NOW }); // 2026-09-16 20:00 local
    await mockHomeDataAndWrites(page, { recent: [feed], todayCount: 1 });
    await gotoHome(page);
    // 20:00:00.000 - 07:42:17.342 = 12h 17m 42.658s, which the headline floors to whole
    // minutes elapsed — "12h 17m ago", not the "12h 18m ago" a whole-minute-clean fixture
    // would've shown (see realisticFeedIso's own comment on why this file uses real seconds).
    await expect(headline(page)).toContainText('12h 17m ago');

    await rowEditButton(page).click();
    const row = page.locator('.row--edit-open');
    await editTimeInput(row).fill('13:00'); // still today, still in the past relative to 20:00

    const patchPromise = page.waitForRequest(
      (req) => req.method() === 'PATCH' && req.url().includes('/rest/v1/feeds')
    );
    await editSaveButton(row).click();
    const patchReq = await patchPromise;
    const patchBody = JSON.parse(patchReq.postData() || '{}');
    const expectedIso = new Date(2026, 8, 16, 13, 0, 0, 0).toISOString(); // same date, new time
    expect(patchBody).toEqual({ created_at: expectedIso });
    expect(patchReq.url()).toContain(`id=eq.${feed.id}`);
    expect(patchReq.url()).toContain('deleted_at=is.null');

    // Row returns to normal, showing the corrected time; headline recomputed off the new time.
    await expect(page.locator('.row--edit-open')).toHaveCount(0, { timeout: 3000 });
    await expect(recentRows(page).first()).toContainText(/1:00\s*PM/);
    await expect(headline(page)).toContainText('7h 0m ago'); // 20:00 - 13:00
  });

  test('AC-21.3b — history: editing a feed from 2:50 AM to 3:10 AM (same calendar date) moves it across the feed-day boundary, updating day-grouping AND the heatmap within 1s', async ({
    page,
  }) => {
    // contract.md §7.11's own worked example: "2:50 AM -> 3:10 AM on the same date moves it
    // from the previous feed day into that date's own feed day" — a deliberate, intentional
    // consequence of "the date field never changes", not a bug (contract.md §7.11's note).
    const originalIso = realisticFeedIso(2, 50); // feed day: Sep 15 ("Yesterday")
    const feed = { id: 'edit-hist-1', created_at: originalIso, logged_by: QA_LOGGED_BY, pet_id: undefined };
    await page.clock.install({ time: NOW }); // 2026-09-16 20:00 local -> today's feed day = Sep 16
    await mockHistoryFirstPageAndWrites(page, [feed]);
    await gotoHistory(page, 'pumo');

    await expect(dayHeading(page, 'Yesterday')).toBeVisible();
    await expect(page.getByText(/2:50\s*AM/)).toBeVisible();

    await rowEditButton(page).click();
    const row = page.locator('.row--edit-open');
    await expect(editTimeInput(row)).toHaveValue('02:50');
    // tasks.md §2's minimum screenshot set: "the edit-time flow open (input pre-filled) ... on
    // a history row" (see AC-21.2a for the home-row counterpart).
    await shot(page, { n: 21, screen: 'history', state: 'edit-open', scheme: 'light' });
    await editTimeInput(row).fill('03:10');
    await editSaveButton(row).click();

    // The feed moves out of "Yesterday" (now empty, so that section disappears entirely) and
    // into "Today", still showing as a single feed overall — exactly like a delete-then-relog
    // would look, but driven by the SAME full render() path (architecture.md §4), no special
    // edit-only rendering logic.
    await expect(dayHeading(page, 'Today')).toBeVisible({ timeout: 3000 });
    await expect(dayHeading(page, 'Yesterday')).toHaveCount(0);
    await expect(page.getByText(/3:10\s*AM/)).toBeVisible();

    // Heatmap: today's cell now has 1 feed, yesterday's cell has 0 — both recomputed live off
    // the same state.feeds, same as after any delete (contract.md §7.11's own note).
    const todayCellLabel = heatmapCellAriaLabelExpected({ date: new Date(2026, 8, 16), count: 1 });
    const yesterdayCellLabel = heatmapCellAriaLabelExpected({ date: new Date(2026, 8, 15), count: 0 });
    await expect(heatmapCellByLabel(page, todayCellLabel)).toBeVisible();
    await expect(heatmapCellByLabel(page, yesterdayCellLabel)).toBeVisible();
  });

  // -----------------------------------------------------------------------------------------
  // AC-21.4 — A future time (beyond EDIT_FUTURE_GRACE_MS) is rejected client-side: inline
  // error, editor stays open, NO network call. A time within the grace window is accepted.
  // -----------------------------------------------------------------------------------------

  test('AC-21.4a — a time more than EDIT_FUTURE_GRACE_MS past now is rejected inline, editor stays open, no PATCH sent (home)', async ({
    page,
  }) => {
    const feed = { id: 'edit-future-1', created_at: realisticFeedIso(7, 0), logged_by: 'Sam' };
    await page.clock.install({ time: NOW }); // 20:00
    await mockHomeDataAndWrites(page, { recent: [feed], todayCount: 1 });
    await gotoHome(page);

    const patchCounter = countFeedRequests(page, 'PATCH');
    await rowEditButton(page).click();
    const row = page.locator('.row--edit-open');
    await editTimeInput(row).fill('20:30'); // 30 min ahead of 20:00 -- well past the 5 min grace
    await editSaveButton(row).click();

    await expect(editFutureRejectedText(row)).toBeVisible();
    await expect(editTimeInput(row)).toHaveValue('20:30'); // rejected value stays for editing
    await expect(editSaveButton(row)).toBeVisible(); // editor stays open, Save still there
    await page.waitForTimeout(300); // give a stray request a moment to have fired, if it would
    expect(patchCounter.count, 'a client-side-rejected future time must never reach the network').toBe(0);
    await shot(page, { n: 21, screen: 'home', state: 'edit-future-rejected', scheme: 'light' });
  });

  test('AC-21.4b — history: same future-time rejection, on a history row', async ({ page }) => {
    const feed = { id: 'edit-future-hist-1', created_at: realisticFeedIso(7, 0), logged_by: QA_LOGGED_BY };
    await page.clock.install({ time: NOW });
    await mockHistoryFirstPageAndWrites(page, [feed]);
    await gotoHistory(page, 'pumo');

    const patchCounter = countFeedRequests(page, 'PATCH');
    await rowEditButton(page).click();
    const row = page.locator('.row--edit-open');
    await editTimeInput(row).fill('20:45');
    await editSaveButton(row).click();
    await expect(editFutureRejectedText(row)).toBeVisible();
    await page.waitForTimeout(300);
    expect(patchCounter.count).toBe(0);
    await shot(page, { n: 21, screen: 'history', state: 'edit-future-rejected', scheme: 'light' });
  });

  test('AC-21.4c — a time within the grace window (EDIT_FUTURE_GRACE_MS, e.g. 2 minutes ahead) is accepted, not rejected', async ({
    page,
  }) => {
    const feed = { id: 'edit-grace-1', created_at: realisticFeedIso(7, 0), logged_by: 'Sam' };
    await page.clock.install({ time: NOW }); // 20:00:00
    await mockHomeDataAndWrites(page, { recent: [feed], todayCount: 1 });
    await gotoHome(page);

    expect(CONSTANTS).not.toHaveProperty('EDIT_FUTURE_GRACE_MS_MISSING'); // sanity no-op
    await rowEditButton(page).click();
    const row = page.locator('.row--edit-open');
    await editTimeInput(row).fill('20:02'); // 2 minutes ahead of "now" — inside the 5-min grace
    await editSaveButton(row).click();
    await expect(editFutureRejectedText(row)).toHaveCount(0);
    await expect(page.locator('.row--edit-open')).toHaveCount(0, { timeout: 3000 }); // saved and closed
  });

  // -----------------------------------------------------------------------------------------
  // AC-21.5 — Unchanged time on Save is a no-op (no network call). Cancel/Escape discard the
  // edit, same pattern as delete's Cancel/Escape.
  // -----------------------------------------------------------------------------------------

  test('AC-21.5a — Save with the time unchanged closes the editor immediately with NO network call', async ({ page }) => {
    // realisticFeedIso gives this feed non-zero seconds/ms (:17.342) — a whole-minute-clean
    // fixture here would silently pass even if the app's "unchanged" check only compared
    // ms-exact timestamps (contract.md §7.11's own check, which a real <input type="time">
    // value can never match), masking a real rewind-on-no-op-Save bug. Using real-shaped data
    // is what actually proves ui.js's own minute-granularity guard (ahead of
    // computeEditedTimestamp) works, not just that SOME code path happens not to fire a PATCH.
    const feed = { id: 'edit-noop-1', created_at: realisticFeedIso(7, 42), logged_by: 'Sam' };
    await page.clock.install({ time: NOW });
    await mockHomeDataAndWrites(page, { recent: [feed], todayCount: 1 });
    await gotoHome(page);

    const patchCounter = countFeedRequests(page, 'PATCH');
    await rowEditButton(page).click();
    const row = page.locator('.row--edit-open');
    await expect(editTimeInput(row)).toHaveValue('07:42');
    await editSaveButton(row).click(); // no change made
    await expect(page.locator('.row--edit-open')).toHaveCount(0);
    await expect(rowEditButton(page)).toBeFocused(); // returns to normal row state
    await page.waitForTimeout(300);
    expect(patchCounter.count, 'an unchanged-time Save must never send a PATCH').toBe(0);
  });

  test('AC-21.5b — Cancel discards the edit and returns the row to normal, no network call', async ({ page }) => {
    const feed = { id: 'edit-cancel-1', created_at: realisticFeedIso(7, 42), logged_by: 'Sam' };
    await page.clock.install({ time: NOW });
    await mockHomeDataAndWrites(page, { recent: [feed], todayCount: 1 });
    await gotoHome(page);

    const patchCounter = countFeedRequests(page, 'PATCH');
    await rowEditButton(page).click();
    const row = page.locator('.row--edit-open');
    await editTimeInput(row).fill('09:00');
    await editCancelButton(row).click();
    await expect(page.locator('.row--edit-open')).toHaveCount(0);
    await expect(recentRows(page).first()).toContainText(/7:42\s*AM/); // unchanged
    await page.waitForTimeout(300);
    expect(patchCounter.count).toBe(0);
  });

  test('AC-21.5c — Escape also cancels the editor, same as Cancel', async ({ page }) => {
    const feed = { id: 'edit-escape-1', created_at: realisticFeedIso(7, 42), logged_by: 'Sam' };
    await page.clock.install({ time: NOW });
    await mockHomeDataAndWrites(page, { recent: [feed], todayCount: 1 });
    await gotoHome(page);

    await rowEditButton(page).click();
    const row = page.locator('.row--edit-open');
    await editTimeInput(row).fill('09:00');
    await row.press('Escape');
    await expect(page.locator('.row--edit-open')).toHaveCount(0);
    await expect(recentRows(page).first()).toContainText(/7:42\s*AM/); // unchanged
  });

  // -----------------------------------------------------------------------------------------
  // AC-21.6 — Network failure on save -> edit-failed state (Retry/Cancel), Retry resends the
  // same (idempotent) PATCH. Target deleted by another phone before Save lands -> "This feed
  // was deleted.", list refreshes afterward (not synchronously — see this file's header note).
  // -----------------------------------------------------------------------------------------

  test('AC-21.6a — a network failure on Save shows the edit-failed state with Retry/Cancel; Retry resends and succeeds', async ({
    page,
  }) => {
    const feed = { id: 'edit-fail-1', created_at: realisticFeedIso(7, 42), logged_by: 'Sam' };
    await page.clock.install({ time: NOW });
    await mockHomeDataAndWrites(page, { recent: [feed], todayCount: 1, patchFailFirst: 1 });
    await gotoHome(page);

    await rowEditButton(page).click();
    // Scope to the stable <li> (role=listitem), not the `.row--edit-open` class: ui.js's
    // render() swaps that class for `.row--confirm` the instant the state moves to
    // 'edit-failed' (same pattern the pre-existing delete-failed state already uses), so a
    // locator pinned to `.row--edit-open` would stop matching anything right when Save fails.
    const row = recentRows(page).first();
    await editTimeInput(row).fill('09:00');
    await editSaveButton(row).click();

    await expect(editFailedText(row)).toBeVisible({ timeout: 5000 });
    await expect(editRetryButton(row)).toBeVisible();
    await expect(editCancelButton(row)).toBeVisible();
    await shot(page, { n: 21, screen: 'home', state: 'edit-failed', scheme: 'light' });

    await editRetryButton(row).click(); // the mock's patchFailFirst:1 only fails the FIRST attempt
    await expect(page.locator('.row--edit-open')).toHaveCount(0, { timeout: 3000 });
    await expect(recentRows(page).first()).toContainText(/9:00\s*AM/);
  });

  test('AC-21.6b — target deleted by another phone before Save lands: "This feed was deleted." appears, then the row is dropped by the follow-up background refresh (not synchronously)', async ({
    page,
  }) => {
    const feed = { id: 'edit-gone-1', created_at: realisticFeedIso(7, 42), logged_by: 'Sam' };
    await page.clock.install({ time: NOW });
    // D6 (qa-report.md): with a zero-latency mocked GET and no app-side guard, this scenario
    // used to be flaky (confirmed by direct repro: failed roughly 1-in-3 to 1-in-5 runs across
    // both home and history) — the caller's own background refresh could win the race and
    // fully re-render the list, dropping this row, before the row's own local 'edit-deleted'
    // render ever got painted. Fixed by the Frontend agent: `home.js`/`history.js` now delay
    // that background refresh by `EDIT_DELETED_MESSAGE_DELAY_MS` (1200ms), giving the message
    // a real, deadline-guaranteed reading window. Re-confirmed stable (5/5 clean runs) even
    // with NO artificial mock latency — this test intentionally does not add any, so it keeps
    // exercising the real fix rather than a mock-side crutch.
    await mockHomeDataAndWrites(page, { recent: [feed], todayCount: 1, alreadyDeletedIds: [feed.id] });
    await gotoHome(page);

    await rowEditButton(page).click();
    // Same stable-locator reasoning as AC-21.6a: 'edit-deleted' also renders under
    // `.row--confirm`, not `.row--edit-open`, so scope to the <li> itself instead.
    const row = recentRows(page).first();
    await editTimeInput(row).fill('09:00');
    await editSaveButton(row).click();

    // The message must actually appear (per this file's header note, quoting the Frontend
    // agent's own flag) — this is the part that would be a real defect if it never showed.
    await expect(editDeletedText(row)).toBeVisible({ timeout: 5000 });
    await shot(page, { n: 21, screen: 'home', state: 'edit-target-deleted', scheme: 'light' });

    // And it must actually clear once the background refresh (already fired the moment the
    // alreadyDeleted PATCH resolved) lands — the mock's GET now excludes this id, simulating
    // the other phone's real deletion. This is the part that would be a real defect if the
    // message (or the row) never went away at all. Not asserting exactly WHEN within that
    // window — only that it does resolve.
    await expect(row).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByText('When Pumo gets fed, tap the button below.')).toBeVisible();
  });

  test('AC-21.6c — history: target deleted by another phone before Save lands, same message + eventual drop', async ({
    page,
  }) => {
    const feed = { id: 'edit-gone-hist-1', created_at: realisticFeedIso(7, 42), logged_by: QA_LOGGED_BY };
    await page.clock.install({ time: NOW });
    // See AC-21.6b's own comment (D6) — same fix, same re-confirmation, history side.
    await mockHistoryFirstPageAndWrites(page, [feed], { alreadyDeletedIds: [feed.id] });
    await gotoHistory(page, 'pumo');

    await rowEditButton(page).click();
    // Same stable-locator reasoning as AC-21.6a/b.
    const row = recentRows(page).first();
    await editTimeInput(row).fill('09:00');
    await editSaveButton(row).click();
    await expect(editDeletedText(row)).toBeVisible({ timeout: 5000 });
    await expect(row).toHaveCount(0, { timeout: 5000 });
  });

  // -----------------------------------------------------------------------------------------
  // AC-21.7 — Edit and Delete are each a real <button> with a distinct accessible name, both
  // >=44x44, side by side, without shrinking the row below its 56px floor — at 375x553.
  // -----------------------------------------------------------------------------------------

  test('AC-21.7 — Edit and Delete: distinct accessible names, both >=44x44, row still >=56px tall, at the 375x553 budget', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 553 });
    const feed = { id: 'edit-tap-1', created_at: realisticFeedIso(7, 42), logged_by: 'Sam' };
    await page.clock.install({ time: NOW });
    await mockHomeDataAndWrites(page, { recent: [feed], todayCount: 1 });
    await gotoHome(page);

    const editBtn = rowEditButton(page).first();
    const deleteBtn = rowDeleteButton(page).first();
    const editName = await editBtn.getAttribute('aria-label');
    const deleteName = await deleteBtn.getAttribute('aria-label');
    expect(editName).toMatch(/^Edit feed from .+, by Sam$/);
    expect(deleteName).toMatch(/^Delete feed from .+, by Sam$/);
    expect(editName).not.toBe(deleteName);

    await assertTapTarget(editBtn, { minW: 44, minH: 44 });
    await assertTapTarget(deleteBtn, { minW: 44, minH: 44 });

    // Both real, independent, keyboard-reachable <button>s.
    expect(await editBtn.evaluate((el) => el.tagName)).toBe('BUTTON');
    expect(await deleteBtn.evaluate((el) => el.tagName)).toBe('BUTTON');
    await editBtn.focus();
    await expect(editBtn).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(deleteBtn).toBeFocused(); // Edit and Delete sit adjacent in tab order

    // The row itself must not have shrunk below its 56px floor now that it holds two icon
    // buttons instead of one (design.md §3.1's note; AC-2.3a's pre-existing floor).
    const rowBox = await page.locator('.row').first().boundingBox();
    expect(rowBox.height).toBeGreaterThanOrEqual(56 - 0.5);
  });

  // -----------------------------------------------------------------------------------------
  // AC-21.8 — Only the time is ever editable. Confirmed at the network layer (pet_id/logged_by
  // PATCH attempts still 42501) by specs/00-rest-direct.spec.js's AC-21.8a/AC-21.8b and
  // tests/e2e/evidence/ac-21.4-21.8-sql-verification.json. Here: a source check that api.js's
  // updateFeedTime never sends pet_id or logged_by in its PATCH body.
  // -----------------------------------------------------------------------------------------

  test('AC-21.8c — source check: updateFeedTime\'s PATCH body only ever contains created_at, never pet_id or logged_by', async () => {
    const fs = require('fs');
    const path = require('path');
    const apiPath = path.resolve(__dirname, '..', '..', '..', 'frontend', 'js', 'api.js');
    if (!fs.existsSync(apiPath)) {
      test.skip(true, `frontend/js/api.js does not exist at ${apiPath}.`);
      return;
    }
    const src = fs.readFileSync(apiPath, 'utf8');
    const fn = src.match(/export\s+async\s+function\s+updateFeedTime[\s\S]*?\n}/);
    expect(fn, 'api.js should export an updateFeedTime function (contract.md §6.H)').not.toBeNull();
    const body = fn[0];
    expect(body, 'updateFeedTime must never send pet_id in its PATCH body').not.toMatch(/pet_id\s*:/);
    expect(body, 'updateFeedTime must never send logged_by in its PATCH body').not.toMatch(/logged_by\s*:/);
    expect(body, 'updateFeedTime should send created_at').toMatch(/created_at\s*:/);
  });
});
