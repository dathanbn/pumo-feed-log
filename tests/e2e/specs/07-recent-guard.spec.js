// tests/e2e/specs/07-recent-guard.spec.js
// F7 — AC-7.1, 7.2, 7.4-7.8 (the [QA] ones; AC-7.3 is [UNIT], checked in specs/unit tooling).

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, seedQaLoggerName, simulateHidden, simulateHiddenThenVisible } = require('../helpers/app');
const { logButton, undoNoticeRegion } = require('../helpers/selectors');
const { mockHomeData, mockHomeDataDynamic, mockPets, fakeFeed } = require('../helpers/mock');
const { shot } = require('../helpers/screenshot');
const { MS, pickDaytimeTimezone } = require('../helpers/time');
const { QA_LOGGED_BY, CONSTANTS, PRIMARY_TIMEZONE, LIVE_URL } = require('../config');
const { devices } = require('@playwright/test');

function countPosts(page) {
  const state = { count: 0 };
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/rest/v1/feeds')) state.count++;
  });
  return state;
}

test.describe('F7 — Recent-feed guard (2 hours)', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  test('AC-7.1 — last feed 1h55m ago: first tap arms in place, second tap (within 6s) writes one row, no dialog', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.hours(1) + MS.minutes(55) })], todayCount: 1 });
    await gotoHome(page);
    const posts = countPosts(page);

    await expect(logButton(page)).toHaveText('Log a feed'); // guarded style, same label as ready
    await shot(page, { n: 6, screen: 'home', state: 'guarded-resting', scheme: 'light' });

    await logButton(page).click(); // first tap: arms, writes nothing
    await expect(logButton(page)).toContainText('Fed 1h 55m ago — log another?');
    expect(posts.count, 'the arming tap must not write anything').toBe(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await shot(page, { n: 6, screen: 'home', state: 'armed', phase: 'after', scheme: 'light' });

    await logButton(page).click(); // second tap within ARM_TIMEOUT_MS: writes exactly one row
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
    expect(posts.count, 'the confirming tap should write exactly one row').toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('AC-7.2 — last feed 2h05m ago, fewer than 4 today: normal filled style, one tap writes', async ({
    page,
  }) => {
    const { timezoneId, localHour } = pickDaytimeTimezone(PRIMARY_TIMEZONE);
    // This scenario's guard math (elapsed ms since the last feed) doesn't cross a local-day
    // boundary, and todayCount is supplied directly by the mock rather than derived from
    // real created_at values, so no local-midnight edge applies here regardless of zone.
    // Recorded per tasks.md §2's instruction to note which daytime timezone would apply.
    test.info().annotations.push({
      type: 'timezoneId used',
      description: `${timezoneId} (local hour ${localHour})`,
    });

    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.hours(2) + MS.minutes(5) })], todayCount: 1 });
    await gotoHome(page);
    const posts = countPosts(page);

    await expect(logButton(page)).toHaveText('Log a feed');
    await shot(page, { n: 7, screen: 'home', state: 'ready-normal', scheme: 'light' });

    await logButton(page).click(); // one tap, no arming needed
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
    expect(posts.count).toBe(1);
  });

  test('AC-7.4a — armed with no second tap reverts to guarded after 6s and does not log', async ({ page }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(30) })], todayCount: 1 });
    await page.clock.install({ time: new Date() });
    await gotoHome(page);
    const posts = countPosts(page);

    await logButton(page).click();
    await expect(logButton(page)).toContainText('— log another?');

    await page.clock.fastForward(CONSTANTS.ARM_TIMEOUT_MS + 500);
    await expect(logButton(page)).toHaveText('Log a feed', { timeout: 2000 });
    expect(posts.count, 'an unconfirmed arm must never write').toBe(0);

    // A tap after the revert arms again (doesn't log).
    await logButton(page).click();
    await expect(logButton(page)).toContainText('— log another?');
    expect(posts.count).toBe(0);
  });

  test('AC-7.4b — armed reverts to guarded immediately when the page is hidden', async ({ page }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(30) })], todayCount: 1 });
    await gotoHome(page);

    await logButton(page).click();
    await expect(logButton(page)).toContainText('— log another?');

    await simulateHidden(page);
    // Hidden pages can still be inspected in this headless setup; the revert should be
    // immediate rather than waiting for the 6s timer.
    await expect(logButton(page)).toHaveText('Log a feed', { timeout: 500 });
  });

  test('AC-7.5 — the guard counts feeds from every phone: B\'s feed guards A after A refreshes', async ({
    browser,
  }) => {
    const contextA = await browser.newContext({ ...devices['iPhone 13'] });
    await seedQaLoggerName(contextA, 'QA-test-deviceA');
    let phase = 'initial';
    const pageA = await contextA.newPage();
    // mockHomeDataDynamic doesn't mock getPets() itself — see the AC-6.3 note in
    // specs/06-refresh-focus.spec.js for why this is required, not optional, before gotoHome.
    await mockPets(pageA);
    await mockHomeDataDynamic(pageA, () =>
      phase === 'initial' ? { recent: [], todayCount: 0 } : { recent: [fakeFeed({ agoMs: MS.minutes(2) })], todayCount: 1 }
    );
    await pageA.goto(`${LIVE_URL}/`, { waitUntil: 'load' });
    await expect(logButton(pageA)).toHaveText('Log a feed');
    const postsA = countPosts(pageA);

    // Device B logs a real feed (mechanics covered elsewhere; this spec is about A's guard).
    const feedB = await rest.insertFeed({ logged_by: QA_LOGGED_BY });
    phase = 'after-b-logged';
    await simulateHiddenThenVisible(pageA);

    await logButton(pageA).click(); // A's first tap after refresh should ARM, not log
    await expect(logButton(pageA)).toContainText('— log another?', { timeout: 3000 });
    expect(postsA.count, "A's guarded tap must not write").toBe(0);

    await rest.softDeleteById(feedB.id);
    await contextA.close();
  });

  test('AC-7.6 — if the last feed crosses the 2h mark while the page is open, guard lifts within 30s', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.hours(1) + MS.minutes(59) + MS.seconds(50) })], todayCount: 1 });
    await page.clock.install({ time: new Date() });
    await gotoHome(page);

    // Still guarded just under 2h: a tap should arm, not log.
    await logButton(page).click();
    await expect(logButton(page)).toContainText('— log another?');
    await page.clock.fastForward(CONSTANTS.ARM_TIMEOUT_MS + 200); // let the arm timer revert first
    await expect(logButton(page)).toHaveText('Log a feed');

    // Cross the 2h mark and let the 30s tick notice it.
    await page.clock.fastForward(30_000);
    const posts = countPosts(page);
    await logButton(page).click(); // now unguarded: should log immediately, no arming
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
    expect(posts.count).toBe(1);
  });

  test('AC-7.7 — right after a successful log, the next tap arms instead of logging', async ({ page }) => {
    let state = { recent: [], todayCount: 0 };
    await mockPets(page);
    await mockHomeDataDynamic(page, () => state);
    await gotoHome(page);
    await expect(logButton(page)).toHaveText('Log a feed');

    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    );
    await logButton(page).click();
    const res = await postPromise;
    const row = (await res.json())[0];
    state = { recent: [row], todayCount: 1 }; // reflect the real write for any background refresh
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });

    // Wait out LOGGED_FLASH_MS so the button recomputes to guarded.
    await page.waitForTimeout(CONSTANTS.LOGGED_FLASH_MS + 300);

    const posts = countPosts(page);
    await logButton(page).click(); // must arm, not log again
    await expect(logButton(page)).toContainText('— log another?', { timeout: 2000 });
    expect(posts.count, 'the tap right after a log must not create a second row').toBe(0);

    await rest.softDeleteById(row.id);
  });

  test('AC-7.8 — undoing the only feed from the last 2h removes the recent guard', async ({ page }) => {
    let state = { recent: [], todayCount: 0 };
    await mockPets(page);
    await mockHomeDataDynamic(page, () => state);
    await gotoHome(page);

    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    );
    await logButton(page).click();
    const row = (await postPromise.then((r) => r.json()))[0];
    state = { recent: [row], todayCount: 1 };
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });

    const undoButton = undoNoticeRegion(page).filter({ hasText: /^Logged / }).getByRole('button', { name: 'Undo' });
    await expect(undoButton).toBeVisible({ timeout: 3000 });
    await undoButton.click();
    state = { recent: [], todayCount: 0 }; // reflect the real soft delete
    await page.waitForTimeout(1000);

    const posts = countPosts(page);
    await logButton(page).click(); // guard should be gone: logs immediately
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
    expect(posts.count).toBe(1);

    // Clean up both the undone row and the new one.
    const newRow = await rest.getLastFeeds(1);
    if (newRow[0]) await rest.softDeleteById(newRow[0].id);
  });
});
