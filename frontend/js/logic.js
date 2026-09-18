// Pumo Feed Log: pure logic only. No DOM, no fetch, no storage, no Date.now()/new Date() without
// an explicit `now` parameter. See architecture.md §4 and contract.md §7.

import {
  RECENT_FEED_GUARD_MS,
  DAILY_FEED_TARGET,
  NAME_MAX_LENGTH,
  FEED_DAY_START_HOUR,
  HEATMAP_WEEKS,
  DEFAULT_PET_SLUG,
} from './constants.js';

/**
 * 00:00:00.000 local time on the day of `now`. Handles DST correctly because it's built from
 * the Date constructor's y/m/d fields, not by subtracting milliseconds. (contract.md §7.6)
 * Kept for calendar-day display logic that's independent of the feed day (unchanged in v1.1).
 * @param {Date} now
 * @returns {Date}
 */
export function startOfLocalDay(now) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Local YYYY-MM-DD day key, used for grouping and midnight detection.
 * @param {Date} d
 * @returns {string}
 */
export function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The start of the current *feed day* (v1.1: 3 AM local, not midnight). Built from shifted
 * local y/m/d fields (never raw ms subtraction on the final boundary), so a DST transition
 * can't shift it by an hour — the shifted value only picks which calendar day we floor to.
 * (contract.md §7.6)
 * @param {Date} now
 * @returns {Date}
 */
export function startOfFeedDay(now) {
  const shifted = new Date(now.getTime() - FEED_DAY_START_HOUR * 60 * 60 * 1000);
  return new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate(), FEED_DAY_START_HOUR);
}

/**
 * The feed-day key (YYYY-MM-DD) `d` belongs to: the calendar date its 3 AM–to–3 AM window
 * started on. A 1:30 AM feed belongs to the *previous* day's key. This is the grouping key
 * for the heatmap (§7.8) and for `groupByDay`, `formatFeedLabel` and `formatDayHeading`
 * (§7.6) — all of which compare feed days, not calendar days, as of v1.1.
 * @param {Date} d
 * @returns {string}
 */
export function feedDayKey(d) {
  const shifted = new Date(d.getTime() - FEED_DAY_START_HOUR * 60 * 60 * 1000);
  return dayKey(shifted);
}

/**
 * The feed-day key for the calendar day immediately before `d`'s own feed day. Built with
 * `setDate`-style field arithmetic on the already-shifted value (never a further raw ms
 * subtraction), the same DST-safety reasoning as `startOfFeedDay` (contract.md §7.6).
 * @param {Date} d
 * @returns {string}
 */
function previousFeedDayKey(d) {
  const shifted = new Date(d.getTime() - FEED_DAY_START_HOUR * 60 * 60 * 1000);
  const minusOne = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate() - 1);
  return dayKey(minusOne);
}

/**
 * "1h 40m ago" style relative time. Negative values (clock skew) count as 0.
 * Whole units, rounded down. (contract.md §7.3)
 * @param {number} ms
 * @returns {string}
 */
export function formatRelative(ms) {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  if (totalSeconds < 60) return 'just now';

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ago`;

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const m = totalMinutes % 60;
    return `${totalHours}h ${m}m ago`;
  }

  const totalDays = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  return `${totalDays}d ${h}h ago`;
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * "7:42 AM" in the device locale.
 * @param {Date} d
 * @returns {string}
 */
export function formatTime(d) {
  return TIME_FORMAT.format(d);
}

const WEEKDAY_MONTH_DAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const MONTH_DAY_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const FULL_WEEKDAY_MONTH_DAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const FULL_WEEKDAY_MONTH_DAY_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/**
 * Home-row / delete-sentence label. (contract.md §7.4, §7.6)
 *   same feed day: "Today, 7:42 AM"
 *   previous feed day: "Yesterday, 9:55 PM"
 *   same year: "Mon, Sep 14, 6:30 PM"
 *   other year: "Sep 14, 2025, 6:30 PM"
 * v1.1: "Today"/"Yesterday" compare *feed days* (3 AM boundary), not calendar days — a 1:30 AM
 * feed reads "Yesterday, 1:30 AM" once the clock has passed midnight but not yet 3 AM.
 * @param {{created_at: string}} feed
 * @param {Date} now
 * @returns {string}
 */
export function formatFeedLabel(feed, now) {
  const d = new Date(feed.created_at);
  const time = formatTime(d);
  const feedKey = feedDayKey(d);
  const todayKey = feedDayKey(now);
  if (feedKey === todayKey) return `Today, ${time}`;
  if (feedKey === previousFeedDayKey(now)) return `Yesterday, ${time}`;

  if (d.getFullYear() === now.getFullYear()) {
    return `${WEEKDAY_MONTH_DAY_FORMAT.format(d)}, ${time}`;
  }
  return `${MONTH_DAY_YEAR_FORMAT.format(d)}, ${time}`;
}

/**
 * Day-group heading. (contract.md §7.4, §7.6)
 *   "Today", "Yesterday", "Monday, September 14", or with year if not the current year.
 * v1.1: compares *feed-day* keys, not calendar-day keys, so the heading a feed appears under
 * always matches which day its count was added to. For the same reason, the displayed date
 * itself (in the non-Today/Yesterday branch) is derived from the feed day's own calendar date
 * (`startOfFeedDay(date)`), not from `date` directly — otherwise a post-midnight-pre-3AM `date`
 * (e.g. 1:30 AM Sep 16, feed day Sep 15) would render the wrong calendar date in the heading
 * text even though it's correctly grouped under the Sep 15 bucket.
 * @param {Date} date - a date within the feed day being labeled (local)
 * @param {Date} now
 * @returns {string}
 */
export function formatDayHeading(date, now) {
  const key = feedDayKey(date);
  if (key === feedDayKey(now)) return 'Today';
  if (key === previousFeedDayKey(now)) return 'Yesterday';

  const feedDay = startOfFeedDay(date);
  if (feedDay.getFullYear() === now.getFullYear()) {
    return FULL_WEEKDAY_MONTH_DAY_FORMAT.format(feedDay);
  }
  return FULL_WEEKDAY_MONTH_DAY_YEAR_FORMAT.format(feedDay);
}

/**
 * @typedef {{id: string, pet_id?: string, created_at: string, logged_by: string|null, deleted_at?: string|null}} Feed
 * @typedef {{id: string, slug: string, name: string, species: 'cat'|'dog', sort_order: number, photo_url: string|null}} Pet
 */

/**
 * Guard state for the Log button. (contract.md §7.2)
 * @param {Date} now
 * @param {Feed|null|undefined} lastFeed
 * @param {number} todayCount
 * @returns {{recent: boolean, daily: boolean, guarded: boolean, elapsed: number|null}}
 */
export function guardState(now, lastFeed, todayCount) {
  const elapsed = lastFeed ? Math.max(0, now.getTime() - Date.parse(lastFeed.created_at)) : null;
  const recent = lastFeed != null && elapsed < RECENT_FEED_GUARD_MS;
  const daily = todayCount >= DAILY_FEED_TARGET;
  const guarded = recent || daily;
  return { recent, daily, guarded, elapsed };
}

/**
 * The armed-button label. (contract.md §7.2)
 * @param {{recent: boolean, daily: boolean, elapsed: number|null}} g
 * @param {number} todayCount
 * @returns {string}
 */
export function armedLabel(g, todayCount) {
  if (g.recent && g.daily) {
    return `Fed ${formatRelative(g.elapsed)}, ${todayCount} of ${DAILY_FEED_TARGET} today — log another?`;
  }
  if (g.recent) {
    return `Fed ${formatRelative(g.elapsed)} — log another?`;
  }
  return `${todayCount} of ${DAILY_FEED_TARGET} today — log another?`;
}

/**
 * The armed-state live-region announcement. (design.md §7)
 * @param {{recent: boolean, daily: boolean, elapsed: number|null}} g
 * @param {number} todayCount
 * @param {string} petName
 * @returns {string}
 */
export function armedAnnouncement(g, todayCount, petName) {
  const parts = [];
  if (g.recent) parts.push(`${petName} was fed ${formatRelative(g.elapsed)}.`);
  if (g.daily) parts.push(`${todayCount} of ${DAILY_FEED_TARGET} fed today.`);
  parts.push('Tap again to log another feed.');
  return parts.join(' ');
}

/**
 * Delete confirmation sentence. (contract.md §7.5, §7.6)
 * "Today" here means the *feed day* (v1.1), consistent with the counter and formatFeedLabel.
 * @param {Feed} target
 * @param {Feed[]} feeds - currently loaded live feeds, newest first
 * @param {number} todayCount
 * @param {Date} now
 * @returns {string}
 */
export function deleteConsequence(target, feeds, todayCount, now) {
  const live = feeds.filter((f) => f.id !== target.id);
  const targetIsToday = feedDayKey(new Date(target.created_at)) === feedDayKey(now);
  const targetLabel = targetIsToday ? formatTime(new Date(target.created_at)) : formatFeedLabel(target, now);

  const isNewest = feeds.length > 0 && feeds[0].id === target.id;

  const parts = [];
  if (isNewest && live.length > 0) {
    const next = live[0];
    const nextIsToday = feedDayKey(new Date(next.created_at)) === feedDayKey(now);
    const nextLabel = nextIsToday ? formatTime(new Date(next.created_at)) : formatFeedLabel(next, now);
    parts.push(`Last feed will then show ${nextLabel}.`);
  } else if (isNewest && live.length === 0) {
    parts.push('There will be no feeds left.');
  }

  if (targetIsToday) {
    parts.push(`Today's count goes from ${todayCount} to ${todayCount - 1}.`);
  }

  if (parts.length === 0) {
    parts.push("Last feed time and today's count won't change.");
  }

  return `Delete the ${targetLabel} feed? ${parts.join(' ')}`;
}

/**
 * Groups feeds (newest first) into feed-day buckets (v1.1: 3 AM boundary, not calendar
 * midnight), each newest first, buckets newest first.
 * @param {Feed[]} feeds
 * @param {Date} now
 * @returns {{key: string, heading: string, date: Date, feeds: Feed[]}[]}
 */
export function groupByDay(feeds, now) {
  const groups = [];
  const byKey = new Map();
  for (const feed of feeds) {
    const d = new Date(feed.created_at);
    const key = feedDayKey(d);
    let group = byKey.get(key);
    if (!group) {
      group = { key, heading: formatDayHeading(d, now), date: d, feeds: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.feeds.push(feed);
  }
  return groups;
}

/**
 * Trim, collapse internal whitespace runs to one space, cut to NAME_MAX_LENGTH. Empty → null.
 * (contract.md §7.7)
 * @param {string} input
 * @returns {string|null}
 */
export function sanitizeName(input) {
  if (input == null) return null;
  const collapsed = String(input).trim().replace(/\s+/g, ' ');
  const cut = collapsed.slice(0, NAME_MAX_LENGTH);
  return cut.length === 0 ? null : cut;
}

/**
 * A v4 UUID, via crypto.randomUUID() when available, else built from crypto.getRandomValues.
 * @returns {string}
 */
export function newFeedId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The accessible label for a row's Delete control. (design.md §7)
 * @param {Feed} feed
 * @param {Date} now
 * @returns {string}
 */
export function deleteAriaLabel(feed, now) {
  const name = feed.logged_by || 'Someone';
  return `Delete feed from ${formatFeedLabel(feed, now)}, by ${name}`;
}

// ---- v1.1: heatmap (contract.md §7.8) --------------------------------------------------------

/**
 * 0 → empty tier, 1/2/3 → their own tier, 4-or-more → the top tier (matches DAILY_FEED_TARGET).
 * @param {number} count
 * @returns {0|1|2|3|4}
 */
export function heatmapIntensity(count) {
  if (count >= DAILY_FEED_TARGET) return 4;
  if (count <= 0) return 0;
  return count;
}

/**
 * Builds the calendar-grid heatmap model, ending on today's own (possibly partial) Sun–Sat
 * week and covering exactly `weeks` full calendar weeks (`weeks * 7` cells), as required by
 * AC-18.1 ("covering HEATMAP_WEEKS (5) weeks") and design.md §4.1 ("HEATMAP_WEEKS (5) rows").
 * Matches contract.md §7.8: anchored on `end` (today) — `gridEnd` is the Saturday on/after
 * `end`, and `gridStart` is exactly `weeks * 7 - 1` days before it, landing on a Sunday for any
 * weekday `end` falls on (the standard "calendar heatmap" approach, as GitHub's contribution
 * graph uses), so there's no leading padding, only trailing (future-dated) padding in today's
 * own row past `end`. Pure, no DOM.
 * @param {Feed[]} feeds - every currently-loaded live feed for the selected pet, newest first
 * @param {Date} now
 * @param {number} [weeks]
 * @returns {{
 *   weeks: Array<Array<{date: Date, feedDayKey: string, count: number, inRange: boolean, isToday: boolean, intensity: 0|1|2|3|4}>>,
 *   start: Date, end: Date
 * }}
 */
export function buildHeatmap(feeds, now, weeks = HEATMAP_WEEKS) {
  // `end` is a local midnight standing in for today's feed day's start date — safe for
  // field-based day arithmetic (setDate), and comparable to any cell date built the same way.
  const nowShifted = new Date(now.getTime() - FEED_DAY_START_HOUR * 60 * 60 * 1000);
  const end = new Date(nowShifted.getFullYear(), nowShifted.getMonth(), nowShifted.getDate());

  const gridEnd = new Date(end);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay())); // forward to Saturday
  const gridStart = new Date(gridEnd);
  gridStart.setDate(gridStart.getDate() - (weeks * 7 - 1)); // always lands on a Sunday

  const counts = new Map();
  for (const f of feeds) {
    const key = feedDayKey(new Date(f.created_at));
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const endKey = dayKey(end);
  const allCells = [];
  for (const d = new Date(gridStart); d.getTime() <= gridEnd.getTime(); d.setDate(d.getDate() + 1)) {
    const cellDate = new Date(d);
    const key = dayKey(cellDate); // a cell's own date IS its feed day's start date
    // Every cell here is already >= gridStart by construction — the only out-of-range cells
    // are future dates padding out today's row past `end`.
    const inRange = key <= endKey;
    const count = inRange ? (counts.get(key) || 0) : 0;
    allCells.push({
      date: cellDate,
      feedDayKey: key,
      count,
      inRange,
      isToday: key === endKey,
      intensity: inRange ? heatmapIntensity(count) : 0,
    });
  }

  const weekRows = [];
  for (let i = 0; i < allCells.length; i += 7) {
    weekRows.push(allCells.slice(i, i + 7));
  }

  return { weeks: weekRows, start: gridStart, end };
}

// ---- v1.1: CSV export (contract.md §7.9) -----------------------------------------------------

/**
 * RFC 4180 field: wrap in quotes and double internal quotes only if the field contains a
 * comma, quote or newline.
 * @param {string} value
 * @returns {string}
 */
function csvField(value) {
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Formats a pet's full feed history as CSV text. Pure function — no DOM, no download.
 * (contract.md §7.9)
 * @param {Feed[]} feeds - from getAllFeedsForExport, newest first
 * @param {Pet} pet
 * @returns {string}
 */
export function feedsToCsv(feeds, pet) {
  const rows = [['date', 'pet', 'time', 'feeder']];
  const oldestFirst = [...feeds].reverse();
  for (const feed of oldestFirst) {
    const d = new Date(feed.created_at);
    rows.push([feedDayKey(d), pet.name, formatTime(d), feed.logged_by || 'Someone']);
  }
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

// ---- v1.1: pet URL resolution (contract.md §7.10) ---------------------------------------------

/**
 * Resolves the pet slug named by a `location.search`-style query string, falling back to
 * DEFAULT_PET_SLUG when absent, empty, or not a slug any known pet has. `search` and `pets`
 * are passed in explicitly (never read from `location` here) so this stays a pure, testable
 * function, consistent with `now` always being a parameter elsewhere in this module.
 * @param {string} search - e.g. `location.search`, such as "?pet=banh-mi"
 * @param {Pet[]} pets
 * @returns {string}
 */
export function petSlugFromLocation(search, pets) {
  const params = new URLSearchParams(search || '');
  const raw = params.get('pet');
  if (!raw) return DEFAULT_PET_SLUG;
  const known = Array.isArray(pets) && pets.some((p) => p.slug === raw);
  return known ? raw : DEFAULT_PET_SLUG;
}

/**
 * Builds the in-app URL for `slug`'s version of `page`. The default pet gets no query string
 * (so its existing NFC sticker, programmed with the bare LIVE_URL, keeps working unchanged).
 * (contract.md §7.10)
 * @param {string} slug
 * @param {string} [page]
 * @returns {string}
 */
export function pathForPet(slug, page = 'index.html') {
  return slug === DEFAULT_PET_SLUG ? page : `${page}?pet=${slug}`;
}
