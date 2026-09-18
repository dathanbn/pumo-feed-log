// Pumo Feed Log: unit tests for frontend/js/logic.js (pure functions only).
// Run with: node --test tests/unit
// Must pass under both TZ=America/Los_Angeles and TZ=UTC (tasks.md Task 3).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  startOfLocalDay,
  dayKey,
  formatRelative,
  formatTime,
  formatFeedLabel,
  formatDayHeading,
  guardState,
  armedLabel,
  deleteConsequence,
  groupByDay,
  sanitizeName,
  newFeedId,
  startOfFeedDay,
  feedDayKey,
  buildHeatmap,
  feedsToCsv,
  petSlugFromLocation,
  pathForPet,
  computeEditedTimestamp,
} from '../../frontend/js/logic.js';

import {
  RECENT_FEED_GUARD_MS,
  DAILY_FEED_TARGET,
  NAME_MAX_LENGTH,
  HEATMAP_WEEKS,
  DEFAULT_PET_SLUG,
  EDIT_FUTURE_GRACE_MS,
} from '../../frontend/js/constants.js';

// ---------------------------------------------------------------------------------------------
describe('formatRelative', () => {
  test('0 s -> just now', () => {
    assert.equal(formatRelative(0), 'just now');
  });
  test('59 s -> just now', () => {
    assert.equal(formatRelative(59_000), 'just now');
  });
  test('60 s -> 1m ago', () => {
    assert.equal(formatRelative(60_000), '1m ago');
  });
  test('59 m -> 59m ago', () => {
    assert.equal(formatRelative(59 * 60_000), '59m ago');
  });
  test('60 m -> 1h 0m ago', () => {
    assert.equal(formatRelative(60 * 60_000), '1h 0m ago');
  });
  test('1h 40m -> 1h 40m ago', () => {
    assert.equal(formatRelative(100 * 60_000), '1h 40m ago');
  });
  test('23h 59m -> 23h 59m ago', () => {
    assert.equal(formatRelative(23 * 3_600_000 + 59 * 60_000), '23h 59m ago');
  });
  test('24 h -> 1d 0h ago', () => {
    assert.equal(formatRelative(24 * 3_600_000), '1d 0h ago');
  });
  test('negative (clock skew) counts as 0 -> just now', () => {
    assert.equal(formatRelative(-5000), 'just now');
  });
});

// ---------------------------------------------------------------------------------------------
describe('guardState', () => {
  const now = new Date(2026, 8, 16, 12, 0, 0, 0);

  test('elapsed 1h 59m 59s -> recent applies', () => {
    const lastFeed = { created_at: new Date(now.getTime() - (1 * 3_600_000 + 59 * 60_000 + 59_000)).toISOString() };
    const g = guardState(now, lastFeed, 0);
    assert.equal(g.recent, true);
    assert.equal(g.guarded, true);
  });

  test('elapsed exactly 2h 00m 00s -> recent does not apply (strictly less-than)', () => {
    const lastFeed = { created_at: new Date(now.getTime() - RECENT_FEED_GUARD_MS).toISOString() };
    const g = guardState(now, lastFeed, 0);
    assert.equal(g.recent, false);
  });

  test(`todayCount ${DAILY_FEED_TARGET - 1} -> daily does not apply`, () => {
    const lastFeed = { created_at: new Date(now.getTime() - 5 * 3_600_000).toISOString() };
    const g = guardState(now, lastFeed, DAILY_FEED_TARGET - 1);
    assert.equal(g.daily, false);
    assert.equal(g.guarded, false);
  });

  test(`todayCount ${DAILY_FEED_TARGET} -> daily applies`, () => {
    const lastFeed = { created_at: new Date(now.getTime() - 5 * 3_600_000).toISOString() };
    const g = guardState(now, lastFeed, DAILY_FEED_TARGET);
    assert.equal(g.daily, true);
    assert.equal(g.guarded, true);
  });

  test('both recent and daily at once', () => {
    const lastFeed = { created_at: new Date(now.getTime() - 40 * 60_000).toISOString() };
    const g = guardState(now, lastFeed, DAILY_FEED_TARGET);
    assert.equal(g.recent, true);
    assert.equal(g.daily, true);
    assert.equal(g.guarded, true);
  });

  test('no feeds at all -> not guarded, elapsed null', () => {
    const g = guardState(now, null, 0);
    assert.equal(g.recent, false);
    assert.equal(g.daily, false);
    assert.equal(g.guarded, false);
    assert.equal(g.elapsed, null);
  });

  test('negative elapsed (clock skew) counts as 0, still counts as recent', () => {
    const lastFeed = { created_at: new Date(now.getTime() + 60_000).toISOString() }; // "future" feed
    const g = guardState(now, lastFeed, 0);
    assert.equal(g.elapsed, 0);
    assert.equal(g.recent, true);
  });
});

// ---------------------------------------------------------------------------------------------
describe('armedLabel', () => {
  const now = new Date(2026, 8, 16, 12, 0, 0, 0);
  const elapsed100min = 100 * 60_000;

  test('recent only', () => {
    const lastFeed = { created_at: new Date(now.getTime() - elapsed100min).toISOString() };
    const g = guardState(now, lastFeed, 2);
    assert.equal(armedLabel(g, 2), 'Fed 1h 40m ago — log another?');
  });

  test('daily only', () => {
    const lastFeed = { created_at: new Date(now.getTime() - 3 * 3_600_000).toISOString() };
    const g = guardState(now, lastFeed, DAILY_FEED_TARGET);
    assert.equal(armedLabel(g, DAILY_FEED_TARGET), `${DAILY_FEED_TARGET} of ${DAILY_FEED_TARGET} today — log another?`);
  });

  test('both at once', () => {
    const lastFeed = { created_at: new Date(now.getTime() - elapsed100min).toISOString() };
    const g = guardState(now, lastFeed, DAILY_FEED_TARGET);
    assert.equal(
      armedLabel(g, DAILY_FEED_TARGET),
      `Fed 1h 40m ago, ${DAILY_FEED_TARGET} of ${DAILY_FEED_TARGET} today — log another?`
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe('startOfLocalDay', () => {
  test('a normal day', () => {
    const now = new Date(2026, 5, 15, 14, 30, 22, 500);
    const sod = startOfLocalDay(now);
    assert.equal(sod.getFullYear(), 2026);
    assert.equal(sod.getMonth(), 5);
    assert.equal(sod.getDate(), 15);
    assert.equal(sod.getHours(), 0);
    assert.equal(sod.getMinutes(), 0);
    assert.equal(sod.getSeconds(), 0);
    assert.equal(sod.getMilliseconds(), 0);
  });

  test('2026-03-08 (America/Los_Angeles spring-forward day)', () => {
    const now = new Date(2026, 2, 8, 14, 0, 0, 0);
    const sod = startOfLocalDay(now);
    assert.equal(sod.getFullYear(), 2026);
    assert.equal(sod.getMonth(), 2);
    assert.equal(sod.getDate(), 8);
    assert.equal(sod.getHours(), 0);
    assert.equal(sod.getMinutes(), 0);
    assert.equal(sod.getMilliseconds(), 0);
    assert.ok(sod.getTime() <= now.getTime());
  });

  test('2026-11-01 (America/Los_Angeles fall-back day)', () => {
    const now = new Date(2026, 10, 1, 14, 0, 0, 0);
    const sod = startOfLocalDay(now);
    assert.equal(sod.getFullYear(), 2026);
    assert.equal(sod.getMonth(), 10);
    assert.equal(sod.getDate(), 1);
    assert.equal(sod.getHours(), 0);
    assert.equal(sod.getMinutes(), 0);
    assert.equal(sod.getMilliseconds(), 0);
    assert.ok(sod.getTime() <= now.getTime());
  });

  test('a feed at 23:59:59.999 belongs to the earlier day; 00:00:00.000 belongs to the next', () => {
    const late = new Date(2026, 8, 15, 23, 59, 59, 999);
    const midnight = new Date(2026, 8, 16, 0, 0, 0, 0);
    assert.notEqual(dayKey(late), dayKey(midnight));
    assert.equal(dayKey(late), '2026-09-15');
    assert.equal(dayKey(midnight), '2026-09-16');
    assert.equal(startOfLocalDay(late).getDate(), 15);
    assert.equal(startOfLocalDay(midnight).getDate(), 16);
  });
});

// ---------------------------------------------------------------------------------------------
describe('groupByDay', () => {
  const now = new Date(2026, 8, 16, 20, 0, 0, 0); // today = 2026-09-16

  test('feeds on both sides of midnight, ordering and counts', () => {
    const feeds = [
      { id: '1', created_at: new Date(2026, 8, 16, 19, 0).toISOString() }, // today, newest
      { id: '2', created_at: new Date(2026, 8, 16, 8, 0).toISOString() }, // today
      { id: '3', created_at: new Date(2026, 8, 15, 23, 0).toISOString() }, // yesterday
      { id: '4', created_at: new Date(2026, 8, 15, 9, 0).toISOString() }, // yesterday
      { id: '5', created_at: new Date(2026, 8, 14, 12, 0).toISOString() }, // day before
    ];
    const groups = groupByDay(feeds, now);

    assert.equal(groups.length, 3);
    assert.equal(groups[0].heading, 'Today');
    assert.equal(groups[0].feeds.length, 2);
    assert.deepEqual(groups[0].feeds.map((f) => f.id), ['1', '2']);

    assert.equal(groups[1].heading, 'Yesterday');
    assert.equal(groups[1].feeds.length, 2);
    assert.deepEqual(groups[1].feeds.map((f) => f.id), ['3', '4']);

    assert.equal(groups[2].feeds.length, 1);
    assert.deepEqual(groups[2].feeds.map((f) => f.id), ['5']);
    // The dated (non-Today/Yesterday) heading text itself, not just the bucket's contents —
    // see the dedicated post-midnight-pre-3AM regression test below for the case this used to
    // get wrong (formatDayHeading formatting the raw feed timestamp instead of the feed day).
    assert.ok(groups[2].heading.includes('September 14'), `expected Sep 14 in the older group's heading, got: ${groups[2].heading}`);
  });

  test('empty input -> no groups', () => {
    assert.deepEqual(groupByDay([], now), []);
  });
});

// ---------------------------------------------------------------------------------------------
describe('deleteConsequence (contract.md §7.5 examples)', () => {
  const now = new Date(2026, 8, 16, 20, 0, 0, 0);
  const feedA = { id: 'a', created_at: new Date(2026, 8, 16, 7, 42).toISOString() }; // today, newest
  const feedB = { id: 'b', created_at: new Date(2026, 8, 16, 3, 10).toISOString() }; // today

  test('newest, another feed today exists', () => {
    const result = deleteConsequence(feedA, [feedA, feedB], 2, now);
    assert.equal(result, "Delete the 7:42 AM feed? Last feed will then show 3:10 AM. Today's count goes from 2 to 1.");
  });

  test('not newest, not today -> nothing changes', () => {
    const yesterdayFeed = { id: 'y', created_at: new Date(2026, 8, 15, 21, 55).toISOString() };
    const result = deleteConsequence(yesterdayFeed, [feedA, feedB, yesterdayFeed], 2, now);
    assert.equal(result, "Delete the Yesterday, 9:55 PM feed? Last feed time and today's count won't change.");
  });

  test('newest, no other feed exists', () => {
    const result = deleteConsequence(feedA, [feedA], 1, now);
    assert.equal(result, "Delete the 7:42 AM feed? There will be no feeds left. Today's count goes from 1 to 0.");
  });
});

// ---------------------------------------------------------------------------------------------
describe('sanitizeName', () => {
  test('trims leading/trailing whitespace', () => {
    assert.equal(sanitizeName('  Sam  '), 'Sam');
  });

  test('collapses runs of internal whitespace to one space', () => {
    assert.equal(sanitizeName('Sam    Jones'), 'Sam Jones');
    assert.equal(sanitizeName('Sam\t\n  Jones'), 'Sam Jones');
  });

  test(`cuts to NAME_MAX_LENGTH (${NAME_MAX_LENGTH}) characters`, () => {
    const long = 'A very long name that goes past the limit for sure';
    const result = sanitizeName(long);
    assert.equal(result.length, NAME_MAX_LENGTH);
    assert.equal(result, long.slice(0, NAME_MAX_LENGTH));
  });

  test('empty or whitespace-only input becomes null', () => {
    assert.equal(sanitizeName(''), null);
    assert.equal(sanitizeName('    '), null);
    assert.equal(sanitizeName(null), null);
  });

  test('HTML-looking input is kept as literal text, not stripped or escaped', () => {
    const input = '<img src=x onerror=alert(1)>';
    const result = sanitizeName(input);
    assert.equal(result, input.slice(0, NAME_MAX_LENGTH));
    assert.ok(result.includes('<img'));
  });
});

// ---------------------------------------------------------------------------------------------
describe('newFeedId', () => {
  const V4_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  test('produces a v4 UUID when crypto.randomUUID is available', () => {
    assert.equal(typeof crypto.randomUUID, 'function');
    const id = newFeedId();
    assert.match(id, V4_UUID_RE);
  });

  test('produces a v4 UUID when crypto.randomUUID is NOT available (getRandomValues fallback)', () => {
    // randomUUID lives on Crypto.prototype, so `delete crypto.randomUUID` is a silent no-op
    // (it deletes a non-existent own property and the inherited method stays reachable).
    // Shadow it with an own `undefined` property instead, then remove the shadow to restore it.
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });
    try {
      assert.equal(typeof crypto.randomUUID, 'undefined');
      assert.equal(typeof crypto.getRandomValues, 'function');
      const id = newFeedId();
      assert.match(id, V4_UUID_RE);
    } finally {
      delete crypto.randomUUID;
      assert.equal(typeof crypto.randomUUID, 'function');
    }
  });

  test('two calls produce different ids', () => {
    assert.notEqual(newFeedId(), newFeedId());
  });
});

// ---------------------------------------------------------------------------------------------
describe('formatFeedLabel / formatDayHeading (contract.md §7.4 examples)', () => {
  const now = new Date(2026, 8, 16, 20, 0, 0, 0); // 2026-09-16

  test('same local day -> Today, {time}', () => {
    const feed = { created_at: new Date(2026, 8, 16, 7, 42).toISOString() };
    assert.equal(formatFeedLabel(feed, now), `Today, ${formatTime(new Date(2026, 8, 16, 7, 42))}`);
  });

  test('previous local day -> Yesterday, {time}', () => {
    const feed = { created_at: new Date(2026, 8, 15, 21, 55).toISOString() };
    assert.equal(formatFeedLabel(feed, now), `Yesterday, ${formatTime(new Date(2026, 8, 15, 21, 55))}`);
  });

  test('same year, older -> includes weekday + month + day', () => {
    const feed = { created_at: new Date(2026, 8, 10, 18, 30).toISOString() };
    const label = formatFeedLabel(feed, now);
    assert.ok(label.includes('Sep 10'));
    assert.ok(!label.includes('2026'));
  });

  test('different year -> includes the year', () => {
    const feed = { created_at: new Date(2025, 8, 14, 18, 30).toISOString() };
    const label = formatFeedLabel(feed, now);
    assert.ok(label.includes('2025'));
  });

  test('formatDayHeading: Today / Yesterday / weekday date', () => {
    // v1.1: `date` is "a date within the feed day being labeled" (contract.md §7.6) — noon,
    // not literal midnight, since 00:00-02:59 now belongs to the *previous* feed day.
    assert.equal(formatDayHeading(new Date(2026, 8, 16, 12), now), 'Today');
    assert.equal(formatDayHeading(new Date(2026, 8, 15, 12), now), 'Yesterday');
    const heading = formatDayHeading(new Date(2026, 8, 14, 12), now);
    assert.ok(heading.includes('September 14'));
    assert.ok(!heading.includes('2026'));
  });

  test('formatDayHeading includes the year when not the current year', () => {
    const heading = formatDayHeading(new Date(2025, 8, 14), now);
    assert.ok(heading.includes('2025'));
  });
});

// ---------------------------------------------------------------------------------------------
// v1.1: the day boundary moved from local midnight to 3 AM local time (contract.md §7.6, AC-8.5).
describe('startOfFeedDay / feedDayKey (v1.1, contract.md §7.6)', () => {
  test('2:59:59.999 AM belongs to the previous feed day; 3:00:00.000 AM belongs to the current one', () => {
    assert.equal(feedDayKey(new Date(2026, 8, 16, 2, 59, 59, 999)), '2026-09-15');
    assert.equal(feedDayKey(new Date(2026, 8, 16, 3, 0, 0, 0)), '2026-09-16');
  });

  test('startOfFeedDay floors an afternoon time to 3:00:00.000 that same day', () => {
    const sfd = startOfFeedDay(new Date(2026, 8, 16, 14, 30, 22, 500));
    assert.equal(sfd.getFullYear(), 2026);
    assert.equal(sfd.getMonth(), 8);
    assert.equal(sfd.getDate(), 16);
    assert.equal(sfd.getHours(), 3);
    assert.equal(sfd.getMinutes(), 0);
    assert.equal(sfd.getSeconds(), 0);
    assert.equal(sfd.getMilliseconds(), 0);
  });

  test('contract.md §7.6 worked example: 2026-09-17 01:30 local -> feed day starts 2026-09-16 03:00', () => {
    const sfd = startOfFeedDay(new Date(2026, 8, 17, 1, 30, 0, 0));
    assert.equal(sfd.getMonth(), 8);
    assert.equal(sfd.getDate(), 16);
    assert.equal(sfd.getHours(), 3);
  });

  test('2026-03-08 (America/Los_Angeles spring-forward day): just after midnight belongs to 03-07\'s feed day', () => {
    assert.equal(feedDayKey(new Date(2026, 2, 8, 1, 15, 0, 0)), '2026-03-07');
  });

  test('2026-03-08: at/after 3 AM belongs to 03-08\'s own feed day', () => {
    assert.equal(feedDayKey(new Date(2026, 2, 8, 5, 0, 0, 0)), '2026-03-08');
  });

  test('2026-11-01 (America/Los_Angeles fall-back day): just after midnight belongs to 10-31\'s feed day', () => {
    assert.equal(feedDayKey(new Date(2026, 10, 1, 1, 15, 0, 0)), '2026-10-31');
  });

  test('2026-11-01: at/after 3 AM belongs to 11-01\'s own feed day', () => {
    assert.equal(feedDayKey(new Date(2026, 10, 1, 4, 0, 0, 0)), '2026-11-01');
  });

  test('feedDayKey agrees with startOfFeedDay at the boundary (no off-by-one between the two)', () => {
    const dates = [
      new Date(2026, 8, 16, 2, 59, 59, 999),
      new Date(2026, 8, 16, 3, 0, 0, 0),
      new Date(2026, 2, 8, 1, 15, 0, 0),
      new Date(2026, 10, 1, 1, 15, 0, 0),
    ];
    for (const d of dates) {
      assert.equal(feedDayKey(d), dayKey(startOfFeedDay(d)));
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('groupByDay (v1.1: groups by feed day, not calendar day — contract.md §7.6)', () => {
  const now = new Date(2026, 8, 16, 20, 0, 0, 0); // today = 2026-09-16

  test('a 1:30 AM feed groups under the PREVIOUS day, alongside that day\'s evening feed', () => {
    const feeds = [
      { id: 'late', created_at: new Date(2026, 8, 16, 1, 30).toISOString() }, // calendar Sep 16, feed day Sep 15
      { id: 'evening', created_at: new Date(2026, 8, 15, 20, 0).toISOString() }, // calendar + feed day Sep 15
    ];
    const groups = groupByDay(feeds, now);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].heading, 'Yesterday');
    assert.deepEqual(groups[0].feeds.map((f) => f.id), ['late', 'evening']);
  });

  test('a 3:10 AM feed groups under TODAY, not the previous day', () => {
    const feeds = [{ id: 'a', created_at: new Date(2026, 8, 16, 3, 10).toISOString() }];
    const groups = groupByDay(feeds, now);
    assert.equal(groups[0].heading, 'Today');
  });

  // Regression test for the Opus-round-1 defect: formatDayHeading's non-Today/Yesterday branch
  // used to format the raw feed timestamp instead of the feed day's own date, so a group full of
  // post-midnight-pre-3AM feeds got a heading naming the WRONG calendar day (one day ahead of
  // its actual feed day, and — worse — matching a *different* group's real heading, since two
  // adjacent feed-day groups could then render an identical heading text).
  test('a post-midnight-pre-3AM feed in an OLDER (dated, non-Today/Yesterday) group gets a heading matching its feed day, not its raw calendar date', () => {
    const laterNow = new Date(2026, 8, 20, 20, 0, 0, 0); // today = 2026-09-20 (a Sunday)
    const feeds = [
      { id: 'late', created_at: new Date(2026, 8, 16, 1, 30).toISOString() }, // calendar Sep 16, feed day Sep 15
    ];
    const groups = groupByDay(feeds, laterNow);
    assert.equal(groups.length, 1);
    // Grouping key must be the feed day (Sep 15), not the calendar day (Sep 16) — unchanged by
    // this fix, but asserted here too so a heading-only fix can't silently break the grouping.
    assert.equal(groups[0].key, '2026-09-15');
    const heading = groups[0].heading;
    assert.ok(heading.includes('September 15'), `expected the feed day's own date (Sep 15) in the heading, got: ${heading}`);
    assert.ok(!heading.includes('September 16'), `heading must not use the feed's raw calendar date (Sep 16), got: ${heading}`);
    // 2026-09-13 is a Sunday (see the buildHeatmap tests below), so 2026-09-15 is a Tuesday —
    // the feed day's own weekday, not Sep 16's (Wednesday).
    assert.ok(heading.startsWith('Tuesday'), `expected the feed day's own weekday (Tuesday), got: ${heading}`);
  });
});

// ---------------------------------------------------------------------------------------------
describe('formatFeedLabel (v1.1: "Today"/"Yesterday" follow the feed day — AC-8.5)', () => {
  const now = new Date(2026, 8, 16, 20, 0, 0, 0);

  test('a 1:30 AM feed reads "Yesterday, {time}" once the calendar date has turned over', () => {
    const feed = { created_at: new Date(2026, 8, 16, 1, 30, 0, 0).toISOString() };
    assert.equal(formatFeedLabel(feed, now), `Yesterday, ${formatTime(new Date(2026, 8, 16, 1, 30))}`);
  });

  test('a 3:10 AM feed reads "Today, {time}"', () => {
    const feed = { created_at: new Date(2026, 8, 16, 3, 10, 0, 0).toISOString() };
    assert.equal(formatFeedLabel(feed, now), `Today, ${formatTime(new Date(2026, 8, 16, 3, 10))}`);
  });
});

// ---------------------------------------------------------------------------------------------
describe('buildHeatmap (v1.1, contract.md §7.8)', () => {
  test('Sunday always lands in column 0, for `now` values on 3 different weekdays', () => {
    const nowValues = [
      new Date(2026, 8, 13, 12, 0, 0), // Sunday
      new Date(2026, 8, 16, 12, 0, 0), // Wednesday
      new Date(2026, 8, 18, 12, 0, 0), // Friday
    ];
    for (const now of nowValues) {
      const { weeks } = buildHeatmap([], now, HEATMAP_WEEKS);
      for (const week of weeks) {
        assert.equal(week[0].date.getDay(), 0, `first column should be Sunday for now=${now.toDateString()}`);
      }
    }
  });

  test('a day with exactly DAILY_FEED_TARGET feeds gets the top tier; 3 gets the tier below; 0 gets the empty tier', () => {
    const now = new Date(2026, 8, 16, 20, 0, 0, 0);
    const dayA = new Date(2026, 8, 16, 10, 0, 0); // today
    const dayB = new Date(2026, 8, 15, 10, 0, 0); // yesterday
    const feeds = [
      ...Array.from({ length: DAILY_FEED_TARGET }, (_, i) => ({
        id: `a${i}`,
        created_at: new Date(dayA.getTime() + i * 60_000).toISOString(),
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `b${i}`,
        created_at: new Date(dayB.getTime() + i * 60_000).toISOString(),
      })),
    ];
    const cells = buildHeatmap(feeds, now, HEATMAP_WEEKS).weeks.flat();
    const cellA = cells.find((c) => c.feedDayKey === '2026-09-16');
    const cellB = cells.find((c) => c.feedDayKey === '2026-09-15');
    const cellEmpty = cells.find((c) => c.feedDayKey === '2026-09-14');
    assert.equal(cellA.count, DAILY_FEED_TARGET);
    assert.equal(cellA.intensity, 4);
    assert.equal(cellB.count, 3);
    assert.equal(cellB.intensity, 3);
    assert.equal(cellEmpty.count, 0);
    assert.equal(cellEmpty.intensity, 0);
  });

  test('the grid is always exactly HEATMAP_WEEKS full rows (35 cells), for `now` on every weekday', () => {
    // contract.md §7.8 read literally (independently floor `start` to Sunday, ceil `end` to
    // Saturday) does NOT hold this invariant on 6 of 7 weekdays — this asserts the corrected
    // behavior (see buildHeatmap's own doc comment) that AC-18.1/design.md §4.1 require.
    for (let day = 0; day <= 6; day++) {
      // 2026-09-13 is a Sunday; +day sweeps through all 7 weekdays.
      const now = new Date(2026, 8, 13 + day, 20, 0, 0, 0);
      const { weeks } = buildHeatmap([], now, HEATMAP_WEEKS);
      assert.equal(weeks.length, HEATMAP_WEEKS, `expected exactly ${HEATMAP_WEEKS} rows for now=${now.toDateString()}`);
      assert.equal(weeks.flat().length, HEATMAP_WEEKS * 7);
    }
  });

  test('only future dates past today, padding out today\'s own row, are inRange:false — never colored past the empty tier', () => {
    const now = new Date(2026, 8, 16, 20, 0, 0, 0); // Wednesday: today's row still has Thu–Sat left to pad
    const { weeks, end } = buildHeatmap([], now, HEATMAP_WEEKS);
    const cells = weeks.flat();
    const padding = cells.filter((c) => !c.inRange);
    assert.ok(padding.length > 0, 'expected trailing (future) padding cells for a non-Saturday "now"');
    for (const c of padding) {
      assert.ok(c.date.getTime() > end.getTime(), 'every padding cell should be a future date past today');
      assert.equal(c.intensity, 0);
    }
    // No cell in the grid is ever earlier than the grid's own first (Sunday) cell.
    const gridStart = weeks[0][0].date;
    for (const c of cells) {
      assert.ok(c.date.getTime() >= gridStart.getTime());
    }
  });

  test('a 1:30 AM feed lands on the previous day\'s cell (feed-day bucketing, same as groupByDay)', () => {
    const now = new Date(2026, 8, 16, 20, 0, 0, 0);
    const feeds = [{ id: 'late', created_at: new Date(2026, 8, 16, 1, 30, 0, 0).toISOString() }];
    const cells = buildHeatmap(feeds, now, HEATMAP_WEEKS).weeks.flat();
    const cellSep15 = cells.find((c) => c.feedDayKey === '2026-09-15');
    const cellSep16 = cells.find((c) => c.feedDayKey === '2026-09-16');
    assert.equal(cellSep15.count, 1);
    assert.equal(cellSep16.count, 0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('feedsToCsv (v1.1, contract.md §7.9)', () => {
  const pet = { id: 'p1', slug: 'pumo', name: 'Pumo', species: 'cat', sort_order: 0, photo_url: null };

  test('header row is exactly "date,pet,time,feeder"', () => {
    const csv = feedsToCsv([], pet);
    assert.equal(csv.split('\r\n')[0], 'date,pet,time,feeder');
  });

  test('a feeder name containing a comma and a double quote round-trips (RFC 4180 quoting)', () => {
    const feed = {
      id: '1',
      created_at: new Date(2026, 8, 16, 7, 42, 0, 0).toISOString(),
      logged_by: 'Sam, "Jr."',
    };
    const csv = feedsToCsv([feed], pet);
    const dataLine = csv.split('\r\n')[1];
    assert.ok(dataLine.includes('"Sam, ""Jr.""'), `expected RFC 4180 quoting, got: ${dataLine}`);
    // Round-trip: a minimal RFC 4180 field parser recovers the exact original string.
    const field = dataLine.slice(dataLine.indexOf('"'));
    const unquoted = field.slice(1, -1).replace(/""/g, '"');
    assert.equal(unquoted, 'Sam, "Jr."');
  });

  test('null logged_by renders as "Someone"', () => {
    const feed = { id: '1', created_at: new Date(2026, 8, 16, 7, 42, 0, 0).toISOString(), logged_by: null };
    const csv = feedsToCsv([feed], pet);
    assert.ok(csv.split('\r\n')[1].endsWith(',Someone'));
  });

  test('row order is oldest-first (reversed from the newest-first input)', () => {
    const newer = { id: 'n', created_at: new Date(2026, 8, 16, 10, 0).toISOString(), logged_by: 'A' };
    const older = { id: 'o', created_at: new Date(2026, 8, 15, 10, 0).toISOString(), logged_by: 'B' };
    const csv = feedsToCsv([newer, older], pet); // newest-first input, like getAllFeedsForExport
    const lines = csv.trim().split('\r\n');
    assert.ok(lines[1].endsWith(',B'), `expected the older feed first, got: ${lines[1]}`);
    assert.ok(lines[2].endsWith(',A'), `expected the newer feed second, got: ${lines[2]}`);
  });

  test('the date column uses the feed day, not the calendar day, for a 1:30 AM feed', () => {
    const feed = { id: '1', created_at: new Date(2026, 8, 16, 1, 30, 0, 0).toISOString(), logged_by: 'Sam' };
    const csv = feedsToCsv([feed], pet);
    const line = csv.split('\r\n')[1];
    assert.ok(line.startsWith('2026-09-15,'), `expected feed-day date 2026-09-15, got: ${line}`);
  });
});

// ---------------------------------------------------------------------------------------------
describe('petSlugFromLocation / pathForPet (v1.1, contract.md §7.10)', () => {
  const pets = [{ slug: 'pumo' }, { slug: 'zuumi' }, { slug: 'banh-mi' }];

  test('no ?pet= param resolves to DEFAULT_PET_SLUG', () => {
    assert.equal(petSlugFromLocation('', pets), DEFAULT_PET_SLUG);
  });

  test('an empty ?pet= resolves to DEFAULT_PET_SLUG', () => {
    assert.equal(petSlugFromLocation('?pet=', pets), DEFAULT_PET_SLUG);
  });

  test('an unrecognized slug resolves to DEFAULT_PET_SLUG', () => {
    assert.equal(petSlugFromLocation('?pet=rex', pets), DEFAULT_PET_SLUG);
  });

  test('a recognized slug resolves to itself', () => {
    assert.equal(petSlugFromLocation('?pet=zuumi', pets), 'zuumi');
    assert.equal(petSlugFromLocation('?pet=banh-mi', pets), 'banh-mi');
  });

  test('pathForPet(DEFAULT_PET_SLUG) returns the bare page name, with no query string', () => {
    assert.equal(pathForPet(DEFAULT_PET_SLUG), 'index.html');
    assert.equal(pathForPet(DEFAULT_PET_SLUG, 'history.html'), 'history.html');
  });

  test('pathForPet for any other slug returns "{page}?pet={slug}"', () => {
    assert.equal(pathForPet('zuumi'), 'index.html?pet=zuumi');
    assert.equal(pathForPet('banh-mi', 'history.html'), 'history.html?pet=banh-mi');
  });
});

// ---------------------------------------------------------------------------------------------
describe('computeEditedTimestamp (v1.2, contract.md §7.11)', () => {
  test('a valid past-today time returns {ok:true, unchanged:false}, preserving the original calendar date', () => {
    const now = new Date(2026, 8, 16, 20, 0, 0, 0);
    const originalIso = new Date(2026, 8, 16, 7, 42, 0, 0).toISOString();
    const result = computeEditedTimestamp(originalIso, '08:15', now);
    assert.equal(result.ok, true);
    assert.equal(result.unchanged, false);
    const edited = new Date(result.iso);
    assert.equal(edited.getFullYear(), 2026);
    assert.equal(edited.getMonth(), 8);
    assert.equal(edited.getDate(), 16); // same calendar date as the original, not shifted
    assert.equal(edited.getHours(), 8);
    assert.equal(edited.getMinutes(), 15);
  });

  test('the exact original time round-trips to {unchanged: true}', () => {
    const now = new Date(2026, 8, 16, 20, 0, 0, 0);
    const original = new Date(2026, 8, 16, 7, 42, 0, 0);
    const result = computeEditedTimestamp(original.toISOString(), '07:42', now);
    assert.equal(result.ok, true);
    assert.equal(result.unchanged, true);
  });

  test(`a time more than EDIT_FUTURE_GRACE_MS (${EDIT_FUTURE_GRACE_MS}ms) past now on today's date is rejected as 'future'`, () => {
    const now = new Date(2026, 8, 16, 10, 0, 0, 0); // 10:00 AM
    const originalIso = new Date(2026, 8, 16, 7, 0, 0, 0).toISOString();
    // 10:10 AM is 10 minutes after `now`, well past the 5-minute grace window.
    const result = computeEditedTimestamp(originalIso, '10:10', now);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'future');
  });

  test('a time within the grace window (e.g. 2 minutes ahead) is accepted', () => {
    const now = new Date(2026, 8, 16, 10, 0, 0, 0); // 10:00 AM
    const originalIso = new Date(2026, 8, 16, 7, 0, 0, 0).toISOString();
    const result = computeEditedTimestamp(originalIso, '10:02', now);
    assert.equal(result.ok, true);
    assert.equal(result.unchanged, false);
  });

  test('an empty string is rejected as invalid', () => {
    const now = new Date(2026, 8, 16, 20, 0, 0, 0);
    const originalIso = new Date(2026, 8, 16, 7, 42, 0, 0).toISOString();
    const result = computeEditedTimestamp(originalIso, '', now);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid');
  });

  test('a malformed value (not matching HH:MM) is rejected as invalid', () => {
    const now = new Date(2026, 8, 16, 20, 0, 0, 0);
    const originalIso = new Date(2026, 8, 16, 7, 42, 0, 0).toISOString();
    for (const bad of ['7:42', '742', 'not-a-time', '07:42:00', '07-42']) {
      const result = computeEditedTimestamp(originalIso, bad, now);
      assert.equal(result.ok, false, `expected ${bad} to be invalid`);
      assert.equal(result.reason, 'invalid');
    }
  });

  test('2026-03-08 (America/Los_Angeles spring-forward day): an edit still lands on the same calendar date', () => {
    const now = new Date(2026, 2, 8, 20, 0, 0, 0);
    const originalIso = new Date(2026, 2, 8, 1, 15, 0, 0).toISOString();
    const result = computeEditedTimestamp(originalIso, '04:30', now);
    assert.equal(result.ok, true);
    const edited = new Date(result.iso);
    assert.equal(edited.getFullYear(), 2026);
    assert.equal(edited.getMonth(), 2);
    assert.equal(edited.getDate(), 8);
    assert.equal(edited.getHours(), 4);
    assert.equal(edited.getMinutes(), 30);
  });

  test('2026-11-01 (America/Los_Angeles fall-back day): an edit still lands on the same calendar date', () => {
    const now = new Date(2026, 10, 1, 20, 0, 0, 0);
    const originalIso = new Date(2026, 10, 1, 1, 15, 0, 0).toISOString();
    const result = computeEditedTimestamp(originalIso, '04:30', now);
    assert.equal(result.ok, true);
    const edited = new Date(result.iso);
    assert.equal(edited.getFullYear(), 2026);
    assert.equal(edited.getMonth(), 10);
    assert.equal(edited.getDate(), 1);
    assert.equal(edited.getHours(), 4);
    assert.equal(edited.getMinutes(), 30);
  });
});
