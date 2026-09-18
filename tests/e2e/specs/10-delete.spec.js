// tests/e2e/specs/10-delete.spec.js
// F10 — AC-10.1 through AC-10.5 (delete any past feed, with one confirmation).

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, seedQaLoggerName } = require('../helpers/app');
const {
  rowDeleteButton,
  confirmCancelButton,
  confirmDeleteButton,
  confirmRetryButton,
} = require('../helpers/selectors');
const { mockHomeData, fakeFeed } = require('../helpers/mock');
const net = require('../helpers/network');
const { assertTapTarget } = require('../helpers/a11y');
const { shot } = require('../helpers/screenshot');
const { MS } = require('../helpers/time');
const { QA_LOGGED_BY } = require('../config');

test.describe('F10 — Delete any past feed, with one confirmation', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  test('AC-10.1 — every recent-list row has a >=44x44 Delete control with a screen-reader label', async ({
    page,
  }) => {
    await mockHomeData(page, {
      recent: [
        fakeFeed({ agoMs: MS.minutes(30), loggedBy: 'Sam' }),
        fakeFeed({ agoMs: MS.hours(3), loggedBy: 'Alex' }),
      ],
      todayCount: 2,
    });
    await gotoHome(page);
    const buttons = rowDeleteButton(page);
    await expect(buttons).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await assertTapTarget(buttons.nth(i), { minW: 44, minH: 44 });
      await expect(buttons.nth(i)).toHaveAccessibleName(/^Delete feed from .+, by .+$/);
    }
  });

  test('AC-10.2 — tapping Delete shows an inline confirmation with the exact deleteConsequence sentence; Cancel restores; nothing written yet', async ({
    page,
  }) => {
    // Reproduces contract.md §7.5's own worked example: feeds today at 7:42 AM and 3:10 AM,
    // deleting 7:42. Times are supplied directly (not derived from "now") for an exact match.
    //
    // The real "now" must be frozen to a safe daytime hour on the SAME calendar date these
    // fixture times use. Without this, running the suite between local midnight and 3 AM (the
    // feed day hasn't rolled over yet — contract.md §7.6) makes `new Date()`'s CALENDAR date
    // disagree with the app's own FEED-day "today", since 7:42 AM/3:10 AM on that calendar date
    // are still in the future relative to a pre-3-AM "now" and read as a different feed day —
    // confirmed by direct repro: unfrozen, deleteConsequence correctly falls back to its
    // documented non-today wording (full date label, no "Today's count..." clause) exactly per
    // contract.md §7.5's own rules; frozen at a sane hour, it produces the exact worked-example
    // sentence. Not a frontend defect — a test-timing flakiness bug in this spec.
    const today = new Date();
    const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
    const at = (h, min) => new Date(y, m, d, h, min, 0).toISOString();
    await page.clock.install({ time: new Date(y, m, d, 11, 0, 0) });
    await mockHomeData(page, {
      recent: [
        { id: 'f-742', created_at: at(7, 42), logged_by: 'QA-test' },
        { id: 'f-310', created_at: at(3, 10), logged_by: 'QA-test' },
      ],
      todayCount: 2,
    });
    await gotoHome(page);

    const posts = [];
    page.on('request', (req) => {
      if (['POST', 'PATCH', 'DELETE'].includes(req.method()) && req.url().includes('/rest/v1/feeds')) {
        posts.push(req.method());
      }
    });

    await rowDeleteButton(page).first().click();
    const sentence = page.getByText(
      "Delete the 7:42 AM feed? Last feed will then show 3:10 AM. Today's count goes from 2 to 1."
    );
    await expect(sentence).toBeVisible();
    await shot(page, { n: 10, screen: 'home', state: 'delete-confirm', phase: 'before', scheme: 'light' });

    // Focus lands on Cancel; Escape cancels too (checked as an alternative path below).
    await expect(confirmCancelButton(page.locator('body'))).toBeFocused();

    await confirmCancelButton(page.locator('body')).click();
    await expect(sentence).toHaveCount(0);
    await expect(rowDeleteButton(page).first()).toBeVisible(); // row restored
    expect(posts.length, 'nothing should be written before confirming').toBe(0);
  });

  test('AC-10.2b — Escape also cancels the confirmation', async ({ page }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(30) })], todayCount: 1 });
    await gotoHome(page);
    await rowDeleteButton(page).first().click();
    await expect(confirmDeleteButton(page.locator('body'))).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmDeleteButton(page.locator('body'))).toHaveCount(0);
    await expect(rowDeleteButton(page).first()).toBeVisible();
  });

  test('AC-10.3 — confirming sets deleted_at; feed disappears within 1s and headline/counter/guard update', async ({
    page,
  }) => {
    const row = await rest.insertFeed({ logged_by: QA_LOGGED_BY });
    await gotoHome(page); // real network: this is the row's real, current state
    const deleteBtn = rowDeleteButton(page).first();
    await expect(deleteBtn).toBeVisible();

    await deleteBtn.click();
    await confirmDeleteButton(page.locator('body')).click();
    await expect(page.getByRole('dialog')).toHaveCount(0); // still no popup dialog anywhere

    await expect
      .poll(async () => {
        const r = await rest.getById(row.id);
        return r && r.deleted_at !== null;
      }, { timeout: 1500 })
      .toBeTruthy();

    await expect(page.getByText('by ' + QA_LOGGED_BY)).toHaveCount(0, { timeout: 1500 });
  });

  test('AC-10.4 — if delete fails, row reads "Couldn\'t delete." with Retry/Cancel, and the feed stays', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(30) })], todayCount: 1 });
    await gotoHome(page);
    // Wait for the row to actually render before layering the PATCH-fail route on top: goto's
    // 'load' event can resolve before the page's own async getPets()->getRecentFeeds() chain
    // finishes, and Playwright's most-recently-registered-route-runs-first order means
    // registering failFirstThenAllow too early can intercept (and, via its own route.continue()
    // for non-PATCH methods, send straight to the network instead of falling through to)
    // mockHomeData's still-in-flight initial GETs — confirmed by direct repro: without this
    // wait, the test is a race that intermittently renders "Can't load feeds" instead of the
    // fixture row. Not a frontend defect — a QA-side test-suite race, fixed here.
    await rowDeleteButton(page).first().waitFor({ state: 'visible', timeout: 8000 });
    net.failFirstThenAllow(page, { methodFilter: 'PATCH', mode: 'abort' });

    await rowDeleteButton(page).first().click();
    await confirmDeleteButton(page.locator('body')).click();

    await expect(page.getByText("Couldn't delete.")).toBeVisible({ timeout: 5000 });
    await expect(confirmRetryButton(page.locator('body'))).toBeVisible();
    await expect(confirmCancelButton(page.locator('body'))).toBeVisible();
    await shot(page, { n: 10, screen: 'home', state: 'delete-failed', scheme: 'light' });
    // "the feed stays": the row wasn't removed from the DOM. While the row is in its 'failed'
    // state it shows Retry/Cancel, not the icon delete button — rowDeleteButton() only matches
    // the normal-state icon button, so it correctly has count 0 right now. Prove the row (and
    // its underlying feed) is still there by cancelling back to normal and confirming the icon
    // delete button — i.e. the same row, same feed — reappears.
    await expect(rowDeleteButton(page)).toHaveCount(0);
    await confirmCancelButton(page.locator('body')).click();
    await expect(rowDeleteButton(page)).toHaveCount(1);
  });

  test('AC-10.5 — only one row can confirm at a time; opening a second cancels the first', async ({
    page,
  }) => {
    // Same feed-day-boundary test-timing class of bug as AC-10.2/AC-12.1b — see those specs'
    // comments. Freeze "now" to a safe daytime hour on the calendar date the fixture times
    // below are built from, so it can't disagree with the app's own feed-day "today" when run
    // between local midnight and 3 AM.
    const today = new Date();
    const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
    const at = (h, min) => new Date(y, m, d, h, min, 0).toISOString();
    await page.clock.install({ time: new Date(y, m, d, 11, 0, 0) });
    await mockHomeData(page, {
      recent: [
        { id: 'f-915', created_at: at(9, 15), logged_by: 'Sam' },
        { id: 'f-1620', created_at: at(16, 20), logged_by: 'Alex' },
      ],
      todayCount: 2,
    });
    await gotoHome(page);

    const samSentence = page.getByText(/Delete the 9:15 AM feed\?/);
    const alexSentence = page.getByText(/Delete the 4:20 PM feed\?/);

    await rowDeleteButton(page).nth(0).click(); // opens Sam's confirmation
    await expect(samSentence).toBeVisible();
    await expect(confirmDeleteButton(page.locator('body'))).toHaveCount(1);

    // The only remaining icon-button belongs to the other (Alex) row, since Sam's row is
    // currently replaced by its confirmation UI.
    await rowDeleteButton(page).nth(0).click();
    await expect(alexSentence).toBeVisible();
    await expect(samSentence).toHaveCount(0, { timeout: 1000 }); // Sam's confirmation was cancelled
    await expect(confirmDeleteButton(page.locator('body'))).toHaveCount(1); // still only one open
    await expect(rowDeleteButton(page)).toHaveCount(1); // Sam's row restored to its normal (icon) form
  });
});
