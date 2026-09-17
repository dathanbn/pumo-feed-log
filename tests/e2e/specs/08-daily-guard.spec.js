// tests/e2e/specs/08-daily-guard.spec.js
// F8 — AC-8.1 through AC-8.5 ([QA] parts; the midnight-boundary math itself is [UNIT]-tested
// separately in tests/unit/logic.test.mjs, which this suite runs and reports on).

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, seedQaLoggerName } = require('../helpers/app');
const { logButton, counterPill } = require('../helpers/selectors');
const { mockHomeData, mockHomeDataDynamic, fakeFeed } = require('../helpers/mock');
const { shot } = require('../helpers/screenshot');
const { MS, pickDaytimeTimezone } = require('../helpers/time');
const { QA_LOGGED_BY, CONSTANTS, PRIMARY_TIMEZONE } = require('../config');

function countPosts(page) {
  const state = { count: 0 };
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/rest/v1/feeds')) state.count++;
  });
  return state;
}

test.describe('F8 — Daily count guard', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  test('AC-8.1a — "0 of 4 today" with no feeds today', async ({ page }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);
    await expect(counterPill(page)).toContainText('0 of 4 today');
  });

  test('AC-8.1b — counter reflects n regardless of value', async ({ page }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.hours(5) })], todayCount: 2 });
    await gotoHome(page);
    await expect(counterPill(page)).toContainText('2 of 4 today');
  });

  test('AC-8.2a — n=3: normal style (no warning text)', async ({ page }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.hours(5) })], todayCount: 3 });
    await gotoHome(page);
    await expect(counterPill(page)).toContainText('3 of 4 today');
    await expect(page.getByText('daily limit reached')).toHaveCount(0);
    await shot(page, { n: 8, screen: 'home', state: 'counter-normal-3', scheme: 'light' });
  });

  test('AC-8.2b — n=4: warning style, icon, hidden "daily limit reached" text', async ({ page }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.hours(5) })], todayCount: 4 });
    await gotoHome(page);
    await expect(counterPill(page)).toContainText('4 of 4 today');
    await expect(page.getByText('daily limit reached')).toHaveCount(1);
    await shot(page, { n: 8, screen: 'home', state: 'counter-warning-4', scheme: 'light' });
  });

  test('AC-8.2c — n=5: still warning style, reads "5 of 4 today" (keeps counting past target)', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.hours(5) })], todayCount: 5 });
    await gotoHome(page);
    await expect(counterPill(page)).toContainText('5 of 4 today');
    await expect(page.getByText('daily limit reached')).toHaveCount(1);
    await shot(page, { n: 8, screen: 'home', state: 'counter-warning-5', scheme: 'light' });
  });

  test('AC-8.3 — n=4, last feed >2h old: first tap arms "4 of 4 today — log another?", second tap logs, then 5 of 4', async ({
    page,
  }) => {
    const { timezoneId, localHour } = pickDaytimeTimezone(PRIMARY_TIMEZONE);
    test.info().annotations.push({ type: 'timezoneId used', description: `${timezoneId} (local hour ${localHour})` });

    let state = { recent: [fakeFeed({ agoMs: MS.hours(3) })], todayCount: 4 };
    await mockHomeDataDynamic(page, () => state);
    await gotoHome(page);
    const posts = countPosts(page);

    await expect(logButton(page)).toHaveText('Log a feed'); // guarded style, same label
    await logButton(page).click();
    await expect(logButton(page)).toContainText('4 of 4 today — log another?');
    expect(posts.count, 'arming tap must not write').toBe(0);

    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    );
    await logButton(page).click();
    const row = (await postPromise.then((r) => r.json()))[0];
    state = { recent: [row, ...state.recent].slice(0, 3), todayCount: 5 };
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
    expect(posts.count).toBe(1);

    await expect(counterPill(page)).toContainText('5 of 4 today', { timeout: 5000 });
    await rest.softDeleteById(row.id);
  });

  test('AC-8.4 — both guards: one combined armed label, exactly 2 taps total to log', async ({ page }) => {
    let state = {
      recent: [fakeFeed({ agoMs: MS.minutes(40) })],
      todayCount: 4,
    };
    await mockHomeDataDynamic(page, () => state);
    await gotoHome(page);
    const posts = countPosts(page);

    await logButton(page).click(); // tap 1: arms
    await expect(logButton(page)).toContainText('Fed 40m ago, 4 of 4 today — log another?');
    expect(posts.count).toBe(0);
    await shot(page, { n: 8, screen: 'home', state: 'armed-combined', scheme: 'light' });

    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    );
    await logButton(page).click(); // tap 2: logs
    const row = (await postPromise.then((r) => r.json()))[0];
    state = { recent: [row], todayCount: 5 };
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
    expect(posts.count, 'exactly 2 taps total should produce exactly 1 write').toBe(1);

    await rest.softDeleteById(row.id);
  });

  test('AC-8.5 — local midnight: counter resets to "0 of 4 today" within 30s; recent guard can still apply', async ({
    page,
  }) => {
    // 2026-09-17 is within PDT (UTC-7). Timezone must match the context's configured
    // timezoneId (America/Los_Angeles, the suite's primary zone) for this math to hold.
    const beforeMidnight = new Date('2026-09-17T23:59:50-07:00');
    const afterMidnight = new Date('2026-09-18T00:00:30-07:00');
    const lateFeedCreatedAt = '2026-09-17T23:30:00-07:00'; // "an 11:30 PM feed" per AC-8.5's own example

    let phase = 'before';
    await mockHomeDataDynamic(page, () => ({
      recent: [{ id: 'late-feed', created_at: lateFeedCreatedAt, logged_by: QA_LOGGED_BY }],
      todayCount: phase === 'before' ? 4 : 0,
    }));

    await page.clock.install({ time: beforeMidnight });
    await gotoHome(page);
    await expect(counterPill(page)).toContainText('4 of 4 today');

    phase = 'after';
    const msToAdvance = afterMidnight.getTime() - beforeMidnight.getTime();
    expect(msToAdvance).toBeGreaterThan(CONSTANTS.TICK_MS); // the 30s tick must fire within this jump
    await page.clock.fastForward(msToAdvance);

    await expect(counterPill(page)).toContainText('0 of 4 today', { timeout: 5000 });
    await expect(page.getByText('daily limit reached')).toHaveCount(0);

    // The recent guard (the same 11:30 PM feed, now ~30 minutes old) can still apply: a tap
    // should arm with ONLY the recent-guard wording, no "of 4 today" in it.
    const posts = countPosts(page);
    await logButton(page).click();
    await expect(logButton(page)).toContainText('— log another?');
    await expect(logButton(page)).toContainText('Fed');
    await expect(logButton(page)).not.toContainText('of 4 today');
    expect(posts.count, 'the arming tap must not write').toBe(0);
  });
});
