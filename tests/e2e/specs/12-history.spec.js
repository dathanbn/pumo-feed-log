// tests/e2e/specs/12-history.spec.js
// F12 — AC-12.1 through AC-12.4 (full history screen).

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, gotoHistory, seedQaLoggerName, simulateHiddenThenVisible } = require('../helpers/app');
const { fullHistoryLink, showOlderFeedsButton, historyBackLink } = require('../helpers/selectors');
const { mockHomeData, mockHistoryFirstPage } = require('../helpers/mock');
const { formatDayHeadingExpected } = require('../helpers/format');
const { shot } = require('../helpers/screenshot');
const { MS } = require('../helpers/time');
const { QA_LOGGED_BY, CONSTANTS } = require('../config');

test.describe('F12 — Full history', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  test('AC-12.1a — "Full history" link opens history.html', async ({ page }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);
    await fullHistoryLink(page).click();
    await expect(page).toHaveURL(/history\.html/);
  });

  test('AC-12.1b/12.2 — grouped by local day (Today/Yesterday/date), newest first, day counts shown', async ({
    page,
  }) => {
    const now = new Date();
    const older = new Date(now);
    older.setDate(older.getDate() - 8); // safely outside "Yesterday"

    const at = (base, h, min) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, min, 0).toISOString();
    const feeds = [
      { id: 't2', created_at: at(now, 19, 5), logged_by: 'Sam' },
      { id: 't1', created_at: at(now, 7, 42), logged_by: 'Alex' },
      { id: 'y1', created_at: at(new Date(now.getTime() - MS.days(1)), 21, 55), logged_by: null },
      { id: 'o3', created_at: at(older, 18, 0), logged_by: 'Sam' },
      { id: 'o2', created_at: at(older, 12, 0), logged_by: 'Sam' },
      { id: 'o1', created_at: at(older, 8, 0), logged_by: 'Alex' },
    ];
    await mockHistoryFirstPage(page, feeds);
    await gotoHistory(page);

    const todayHeading = page.getByRole('heading', { level: 2, name: 'Today' });
    const yesterdayHeading = page.getByRole('heading', { level: 2, name: 'Yesterday' });
    const olderHeading = page.getByRole('heading', { level: 2, name: formatDayHeadingExpected(older, now) });

    await expect(todayHeading).toBeVisible();
    await expect(yesterdayHeading).toBeVisible();
    await expect(olderHeading).toBeVisible();

    // The per-day count (e.g. "2 feeds") sits next to the <h2>, not inside it — check the
    // heading's immediate container rather than the heading element itself.
    const headingRow = (heading) => heading.locator('xpath=..');
    await expect(headingRow(todayHeading)).toContainText('2 feeds');
    await expect(headingRow(yesterdayHeading)).toContainText('1 feed');
    await expect(headingRow(olderHeading)).toContainText('3 feeds');

    // Day order: Today, then Yesterday, then the older date.
    const headings = page.getByRole('heading', { level: 2 });
    await expect(headings.nth(0)).toContainText('Today');
    await expect(headings.nth(1)).toContainText('Yesterday');
    await expect(headings.nth(2)).toContainText(formatDayHeadingExpected(older, now));

    // Within "Today", newest first: 7:05 PM row before 7:42 AM row.
    const rows = page.getByRole('listitem');
    const firstRowText = await rows.first().innerText();
    expect(firstRowText).toContain('by Sam'); // t2 (7:05 PM) is newer than t1 (7:42 AM)

    await shot(page, { n: 12, screen: 'history', state: 'grouped', scheme: 'light' });
  });

  test('AC-12.3 — first 100 load; "Show older feeds" loads the next page and merges; hides once < 100 return', async ({
    page,
  }) => {
    test.setTimeout(180_000); // seeding 101 real rows sequentially takes a while

    const before = (await rest.listLiveQaTestRows()).length;
    const seeded = await rest.seedFeeds(101, QA_LOGGED_BY);
    try {
      await gotoHistory(page); // real network — genuinely exercises paging against Supabase

      await expect(showOlderFeedsButton(page)).toBeVisible({ timeout: 10000 });
      const rowsBefore = await page.getByRole('listitem').count();
      expect(rowsBefore, 'first page should show up to HISTORY_PAGE_SIZE (100) rows').toBeGreaterThanOrEqual(
        Math.min(100, CONSTANTS.HISTORY_PAGE_SIZE)
      );

      await showOlderFeedsButton(page).click();
      await expect
        .poll(async () => page.getByRole('listitem').count(), { timeout: 10000 })
        .toBeGreaterThan(rowsBefore);

      // Once fewer than 100 remain to load, the button must disappear.
      await expect(showOlderFeedsButton(page)).toHaveCount(0, { timeout: 10000 });
    } finally {
      for (const row of seeded) {
        await rest.softDeleteById(row.id).catch(() => {});
      }
      const after = (await rest.listLiveQaTestRows()).length;
      expect(after, 'no live QA-test rows should remain after this test').toBe(before);
    }
  });

  test('AC-12.4a — deleted feeds are not listed', async ({ page }) => {
    const row = await rest.insertFeed({ logged_by: QA_LOGGED_BY });
    await rest.softDeleteById(row.id);
    await gotoHistory(page); // real network
    await expect(page.getByText('by ' + QA_LOGGED_BY)).toHaveCount(0);
  });

  test('AC-12.4b — the back link returns to the home screen, which shows fresh data', async ({ page }) => {
    await mockHistoryFirstPage(page, []);
    await gotoHistory(page);
    await historyBackLink(page).click();
    await expect(page).toHaveURL(/\/(index\.html)?$/);
    await simulateHiddenThenVisible(page); // sanity: home is interactive, not a stale snapshot
  });
});
