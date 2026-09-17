// tests/e2e/specs/02-home-headline.spec.js
// F2 — AC-2.1 through AC-2.5.
//
// Uses mocked home-data GET responses (helpers/mock.js) for the display/formatting
// assertions, so results are deterministic regardless of any real feeds already in the
// shared production Supabase project (see that file's header comment for why). AC-2.5's
// end-to-end half additionally proves the real delete-then-reload path.

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, seedQaLoggerName } = require('../helpers/app');
const { headline, counterPill, recentRows, logButton, fullHistoryLink } = require('../helpers/selectors');
const { shot } = require('../helpers/screenshot');
const { mockHomeData, fakeFeed } = require('../helpers/mock');
const { MS } = require('../helpers/time');
const { QA_LOGGED_BY, CONSTANTS } = require('../config');

test.describe('F2 — Home headline and recent list', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  test('AC-2.1a — "Last fed 1h 40m ago" for a feed 1h40m old', async ({ page }) => {
    await mockHomeData(page, {
      recent: [fakeFeed({ agoMs: MS.hours(1) + MS.minutes(40) })],
      todayCount: 1,
    });
    await gotoHome(page);
    await expect(headline(page)).toContainText('Last fed 1h 40m ago');
  });

  test('AC-2.1b — "Last fed just now" for a feed 30s old', async ({ page }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.seconds(30) })], todayCount: 1 });
    await gotoHome(page);
    await expect(headline(page)).toContainText('Last fed just now');
  });

  test('AC-2.2a — 1 feed shows exactly 1 row, no placeholders', async ({ page }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(1), loggedBy: 'Sam' })], todayCount: 1 });
    await gotoHome(page);
    const rows = recentRows(page);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('by Sam');
  });

  test('AC-2.2b — 2 feeds show exactly 2 rows, newest first, "Today, h:mm AM/PM" + "by {name}"', async ({
    page,
  }) => {
    await mockHomeData(page, {
      recent: [
        fakeFeed({ agoMs: MS.minutes(1), loggedBy: 'Sam' }),
        fakeFeed({ agoMs: MS.hours(2) + MS.minutes(30), loggedBy: 'Alex' }),
      ],
      todayCount: 2,
    });
    await gotoHome(page);
    const rows = recentRows(page);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('by Sam');
    await expect(rows.nth(0)).toContainText(/Today,\s+\d{1,2}:\d{2}\s*(AM|PM)/i);
    await expect(rows.nth(1)).toContainText('by Alex');
  });

  test('AC-2.3a — 375x553 (iPhone SE, Safari toolbars): everything down to Log button fits, no scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 553 });
    await mockHomeData(page, {
      recent: [
        fakeFeed({ agoMs: MS.hours(1) + MS.minutes(40), loggedBy: 'Sam' }),
        fakeFeed({ agoMs: MS.hours(5), loggedBy: 'Alex' }),
        fakeFeed({ agoMs: MS.hours(22), loggedBy: null }),
      ],
      todayCount: 3,
    });
    await gotoHome(page);

    // AC-2.3's literal requirement at this viewport is that "the headline, daily counter, all
    // 3 rows and the Log button are fully visible" — not that the whole page (footer, the
    // history link, the off-screen-until-opened name card, etc. — none of which AC-2.3 names)
    // fits with zero scroll. Check exactly the elements the AC names, each fully within the
    // 553px viewport with no vertical scroll having occurred (scrollY stays 0).
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY, 'page should not have scrolled on load').toBe(0);

    const mustFit = [headline(page), counterPill(page), recentRows(page).nth(0), recentRows(page).nth(1), recentRows(page).nth(2), logButton(page)];
    for (const locator of mustFit) {
      const box = await locator.boundingBox();
      expect(box, `element must be visible/have a box: ${await locator.evaluate((el) => el.outerHTML.slice(0, 80)).catch(() => '?')}`).not.toBeNull();
      expect(box.y, 'element top should be within the viewport').toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, 'element bottom should be within the 553px viewport').toBeLessThanOrEqual(553);
    }

    await shot(page, { n: 16, screen: 'home', state: 'viewport-375x553', scheme: 'light' });
  });

  test('AC-2.3b — 390x664 (iPhone 13, Safari toolbars): "Full history" link also visible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await mockHomeData(page, {
      recent: [
        fakeFeed({ agoMs: MS.hours(1) + MS.minutes(40), loggedBy: 'Sam' }),
        fakeFeed({ agoMs: MS.hours(5), loggedBy: 'Alex' }),
        fakeFeed({ agoMs: MS.hours(22), loggedBy: null }),
      ],
      todayCount: 3,
    });
    await gotoHome(page);

    await expect(fullHistoryLink(page)).toBeVisible();
    const box = await fullHistoryLink(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box.y + box.height, 'Full history link should be within the 664px viewport').toBeLessThanOrEqual(664);

    await shot(page, { n: 16, screen: 'home', state: 'viewport-390x664', scheme: 'light' });
  });

  test('AC-2.4 — relative time updates without reload within 30s of a 5-minute clock jump', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(10) })], todayCount: 1 });
    // Install the clock at real "now" so mocked created_at (now - 10m) still reads ~10m ago,
    // then fast-forward wall time without touching the mocked data.
    await page.clock.install({ time: new Date() });
    await gotoHome(page);
    await expect(headline(page)).toContainText('10m ago');

    await page.clock.fastForward(MS.minutes(5));
    await page.clock.fastForward(CONSTANTS.TICK_MS); // let the 30s tick loop re-render
    await expect(headline(page)).toContainText('15m ago', { timeout: 5000 });
  });

  test('AC-2.5a — deleted feeds are excluded server-side: the GET itself filters deleted_at', async ({
    page,
  }) => {
    // contract.md §6.A's last-3 query hardcodes `deleted_at=is.null`, and that response
    // shape doesn't even include a deleted_at field — so a deleted feed cannot reach the UI
    // through this endpoint at all. Confirm the app actually sends that filter.
    let sawFilter = false;
    let sawCountFilter = false;
    page.on('request', (req) => {
      if (req.method() !== 'GET') return;
      if (!req.url().includes('/rest/v1/feeds')) return;
      const u = new URL(req.url());
      if (u.searchParams.get('limit') === '3' && u.searchParams.get('deleted_at') === 'is.null') {
        sawFilter = true;
      }
      if (u.searchParams.get('select') === 'id' && u.searchParams.get('deleted_at') === 'is.null') {
        sawCountFilter = true;
      }
    });
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(1) })], todayCount: 1 });
    await gotoHome(page);
    await expect.poll(() => sawFilter, { timeout: 5000 }).toBeTruthy();
    expect(sawCountFilter, 'today-count GET should also filter deleted_at=is.null').toBeTruthy();
  });

  test('AC-2.5b — end to end: deleting the newest real feed then reloading no longer shows it', async ({
    page,
  }) => {
    const target = await rest.insertFeed({ logged_by: QA_LOGGED_BY }); // real, very recent (created "now")
    await rest.softDeleteById(target.id);
    await gotoHome(page);
    // If the deleted feed leaked through, the headline would read "Last fed just now".
    // After deletion it must not, regardless of what other real feed (if any) is now newest.
    await expect(headline(page)).not.toContainText('just now');
  });
});
