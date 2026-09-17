// Pumo Feed Log: pure logic only. No DOM, no fetch, no storage, no Date.now()/new Date() without
// an explicit `now` parameter. See architecture.md §4 and contract.md §7.

import {
  RECENT_FEED_GUARD_MS,
  DAILY_FEED_TARGET,
  NAME_MAX_LENGTH,
} from './constants.js';

/**
 * 00:00:00.000 local time on the day of `now`. Handles DST correctly because it's built from
 * the Date constructor's y/m/d fields, not by subtracting milliseconds. (contract.md §7.6)
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
 * Home-row / delete-sentence label. (contract.md §7.4)
 *   same local day: "Today, 7:42 AM"
 *   previous local day: "Yesterday, 9:55 PM"
 *   same year: "Mon, Sep 14, 6:30 PM"
 *   other year: "Sep 14, 2025, 6:30 PM"
 * @param {{created_at: string}} feed
 * @param {Date} now
 * @returns {string}
 */
export function formatFeedLabel(feed, now) {
  const d = new Date(feed.created_at);
  const time = formatTime(d);
  const feedKey = dayKey(d);
  const todayKey = dayKey(now);
  if (feedKey === todayKey) return `Today, ${time}`;

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (feedKey === dayKey(yesterday)) return `Yesterday, ${time}`;

  if (d.getFullYear() === now.getFullYear()) {
    return `${WEEKDAY_MONTH_DAY_FORMAT.format(d)}, ${time}`;
  }
  return `${MONTH_DAY_YEAR_FORMAT.format(d)}, ${time}`;
}

/**
 * Day-group heading. (contract.md §7.4)
 *   "Today", "Yesterday", "Monday, September 14", or with year if not the current year.
 * @param {Date} date - a date within the day being labeled (local)
 * @param {Date} now
 * @returns {string}
 */
export function formatDayHeading(date, now) {
  const key = dayKey(date);
  if (key === dayKey(now)) return 'Today';

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKey(yesterday)) return 'Yesterday';

  if (date.getFullYear() === now.getFullYear()) {
    return FULL_WEEKDAY_MONTH_DAY_FORMAT.format(date);
  }
  return FULL_WEEKDAY_MONTH_DAY_YEAR_FORMAT.format(date);
}

/**
 * @typedef {{id: string, created_at: string, logged_by: string|null, deleted_at?: string|null}} Feed
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
 * @returns {string}
 */
export function armedAnnouncement(g, todayCount) {
  const parts = [];
  if (g.recent) parts.push(`Pumo was fed ${formatRelative(g.elapsed)}.`);
  if (g.daily) parts.push(`${todayCount} of ${DAILY_FEED_TARGET} fed today.`);
  parts.push('Tap again to log another feed.');
  return parts.join(' ');
}

/**
 * Delete confirmation sentence. (contract.md §7.5)
 * @param {Feed} target
 * @param {Feed[]} feeds - currently loaded live feeds, newest first
 * @param {number} todayCount
 * @param {Date} now
 * @returns {string}
 */
export function deleteConsequence(target, feeds, todayCount, now) {
  const live = feeds.filter((f) => f.id !== target.id);
  const targetIsToday = dayKey(new Date(target.created_at)) === dayKey(now);
  const targetLabel = targetIsToday ? formatTime(new Date(target.created_at)) : formatFeedLabel(target, now);

  const isNewest = feeds.length > 0 && feeds[0].id === target.id;

  const parts = [];
  if (isNewest && live.length > 0) {
    const next = live[0];
    const nextIsToday = dayKey(new Date(next.created_at)) === dayKey(now);
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
 * Groups feeds (newest first) into local-day buckets, each newest first, buckets newest first.
 * @param {Feed[]} feeds
 * @param {Date} now
 * @returns {{key: string, heading: string, date: Date, feeds: Feed[]}[]}
 */
export function groupByDay(feeds, now) {
  const groups = [];
  const byKey = new Map();
  for (const feed of feeds) {
    const d = new Date(feed.created_at);
    const key = dayKey(d);
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
