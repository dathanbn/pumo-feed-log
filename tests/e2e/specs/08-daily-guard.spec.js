// tests/e2e/specs/08-daily-guard.spec.js
// F8 — AC-8.1 through AC-8.5 ([QA] parts; the 3 AM feed-day-boundary math itself is
// [UNIT]-tested separately in tests/unit/logic.test.mjs, which this suite runs and reports
// on — see contract.md §7.6 and tasks.md Task 3's startOfFeedDay/feedDayKey coverage,
// including the 2026-03-08 / 2026-11-01 DST-transition cases).
//
// v1.1 CHANGE (spec.md F8, contract.md §7.6): the feed day now starts at 3:00 AM local, not
// midnight. AC-8.5's QA-side scenario below was rewritten accordingly — it used to jump the
// clock across local midnight; it now jumps across 3:00 AM, and adds the "1:30 AM feed still
// belongs to the PREVIOUS feed day" case spec.md AC-8.5 calls out explicitly. This cannot
// pass until home.js's boundary-tick check uses feedDayKey (contract.md §7.6) instead of the
// old calendar-day check — see architecture.md §4 "loadedDayKey ... is now a feed-day key".

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, seedQaLoggerName } = require('../helpers/app');
const { logButton, counterPill } = require('../helpers/selectors');
const { mockHomeData, mockHomeDataDynamic, mockPets, fakeFeed } = require('../helpers/mock');
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
    await mockPets(page);
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
    await mockPets(page);
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

  test('AC-8.5a — 3 AM feed-day boundary (v1.1, was midnight): counter resets to "0 of 4 today" within 30s; recent guard can still apply', async ({
    page,
  }) => {
    // 2026-09-17 is within PDT (UTC-7). Timezone must match the context's configured
    // timezoneId (America/Los_Angeles, the suite's primary zone) for this math to hold.
    // contract.md §7.6 / spec.md AC-8.5: "With the clock at 03:00:30, the counter reads '0 of
    // 4 today'". Jump across 3:00 AM, not midnight.
    const before3am = new Date('2026-09-18T02:59:50-07:00');
    const after3am = new Date('2026-09-18T03:00:30-07:00');
    // A 1:30 AM feed (after midnight, before 3 AM) — per AC-8.5, this still counts toward the
    // *previous* feed day both before and after this jump (it doesn't newly enter or leave
    // "today" at 3 AM the way a real 11:30 PM-vs-just-past-3AM feed would empty the count).
    const lateFeedCreatedAt = '2026-09-18T01:30:00-07:00';

    let phase = 'before';
    await mockPets(page);
    await mockHomeDataDynamic(page, () => ({
      recent: [{ id: 'late-feed', created_at: lateFeedCreatedAt, logged_by: QA_LOGGED_BY }],
      todayCount: phase === 'before' ? 4 : 0,
    }));

    await page.clock.install({ time: before3am });
    await gotoHome(page);
    await expect(counterPill(page)).toContainText('4 of 4 today');

    phase = 'after';
    const msToAdvance = after3am.getTime() - before3am.getTime();
    expect(msToAdvance).toBeGreaterThan(CONSTANTS.TICK_MS); // the 30s tick must fire within this jump
    await page.clock.fastForward(msToAdvance);

    await expect(counterPill(page)).toContainText('0 of 4 today', { timeout: 5000 });
    await expect(page.getByText('daily limit reached')).toHaveCount(0);

    // The recent guard (the same 1:30 AM feed, now ~1h30m old) can still apply: a tap should
    // arm with ONLY the recent-guard wording, no "of 4 today" in it.
    const posts = countPosts(page);
    await logButton(page).click();
    await expect(logButton(page)).toContainText('— log another?');
    await expect(logButton(page)).toContainText('Fed');
    await expect(logButton(page)).not.toContainText('of 4 today');
    expect(posts.count, 'the arming tap must not write').toBe(0);
  });

  test('AC-8.5b — a feed logged between midnight and 3 AM counts toward the PREVIOUS feed day and labels "Yesterday, {time}" once the calendar date turns over (v1.1)', async ({
    page,
  }) => {
    // contract.md §7.6's own worked example: "at 2026-09-17 01:30 local (before 3 AM),
    // shifted lands on 2026-09-16, so startOfFeedDay returns 2026-09-16 03:00 — that 1:30 AM
    // feed belongs to the 16th's feed day, not the 17th's." spec.md AC-8.5: "its home/history
    // label reads 'Yesterday, 1:30 AM' once the calendar date has turned over."
    const at2am = new Date('2026-09-17T02:00:00-07:00'); // same calendar day as the feed, still before 3 AM
    const lateFeedCreatedAt = '2026-09-17T01:30:00-07:00';

    // Was a STATIC mockHomeData({ todayCount: 1 }) that stayed 1 across the reload below — a
    // QA-side test-suite bug (Opus fix round 1, item 15), not a frontend defect: it produced a
    // self-contradictory screenshot ("Yesterday, 1:30 AM" next to "1 of 4 today", even though
    // under the 3 AM rule that feed no longer belongs to the feed day the counter is showing)
    // and would have masked a real counter bug if the app actually had one. Fixed to recompute
    // dynamically by `phase`, mirroring AC-8.5a just above: before the boundary, the late feed
    // is still today's only feed (1 of 4); after it, today has zero feeds of its own (0 of 4)
    // even though the late feed still shows in the recent list, now relabeled "Yesterday".
    let phase = 'before';
    await mockPets(page);
    await mockHomeDataDynamic(page, () => ({
      recent: [{ id: 'late-feed', created_at: lateFeedCreatedAt, logged_by: QA_LOGGED_BY }],
      todayCount: phase === 'before' ? 1 : 0,
    }));
    await page.clock.install({ time: at2am });
    await gotoHome(page);
    // Still the SAME feed day as the 1:30 AM feed (both before 3 AM on the 17th) -> "Today".
    await expect(page.getByText(/Today, 1:30 AM/)).toBeVisible();
    await expect(counterPill(page)).toContainText('1 of 4 today');
    await shot(page, { n: 8, screen: 'home', state: 'late-night-feed-today-label', scheme: 'light' });

    // Now the calendar date turns over past 3 AM into the 17th's feed day proper — the 1:30
    // AM feed is now the PREVIOUS feed day's, so it must relabel to "Yesterday, 1:30 AM" AND
    // today's own count must drop to 0 (self-consistent: the only feed on screen is yesterday's).
    phase = 'after';
    await page.clock.setSystemTime(new Date('2026-09-17T09:00:00-07:00'));
    await page.reload();
    await expect(page.getByText(/Yesterday, 1:30 AM/)).toBeVisible();
    await expect(counterPill(page)).toContainText('0 of 4 today');
    await shot(page, { n: 8, screen: 'home', state: 'late-night-feed-yesterday-label', scheme: 'light' });
  });
});
