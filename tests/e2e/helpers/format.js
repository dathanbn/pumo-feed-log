// tests/e2e/helpers/format.js
// QA-side reimplementations of contract.md §7.4/§7.6/§7.8/§7.9's formatting/bucketing rules,
// used ONLY to build the expected strings/structures a test asserts against. This is not
// imported by (and has no relationship to) the app's own logic.js — it exists so tests don't
// have to hardcode calendar-dependent strings like weekday names, or re-derive the feed-day
// math by hand in every spec.

'use strict';

const FEED_DAY_START_HOUR = 3; // contract.md §7.1 FEED_DAY_START_HOUR (v1.1)

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** contract.md §7.6 startOfFeedDay(now) (v1.1: 3 AM, not midnight). Field-based construction
 *  (not raw ms subtraction) on the final boundary, for the same DST-safety reason as the
 *  contract's own note — only the intermediate `shifted` value picks which calendar day to
 *  floor to. */
function startOfFeedDayExpected(now) {
  const shifted = new Date(now.getTime() - FEED_DAY_START_HOUR * 60 * 60 * 1000);
  return new Date(
    shifted.getFullYear(),
    shifted.getMonth(),
    shifted.getDate(),
    FEED_DAY_START_HOUR
  );
}

/** contract.md §7.6 feedDayKey(d) = dayKey of startOfFeedDay(d)'s shifted date — the grouping
 *  key for the heatmap (§7.8), groupByDay/formatDayHeading/formatFeedLabel (§7.4/§7.6), and
 *  the CSV date column (§7.9). A 1:30 AM feed's feedDayKey is the PREVIOUS calendar date. */
function feedDayKeyExpected(d) {
  const shifted = new Date(d.getTime() - FEED_DAY_START_HOUR * 60 * 60 * 1000);
  return dayKey(shifted);
}

/** contract.md §7.4 formatDayHeading: Today / Yesterday / "Monday, September 14[, 2025]".
 *  v1.1: "now compares feedDayKey values instead of calendar dayKey values" (contract.md
 *  §7.6) — so a 1:30 AM feed reads "Yesterday" once the clock has passed midnight but not yet
 *  3 AM, matching the day it's grouped/counted under (spec.md AC-8.5's own example). The
 *  weekday/month/day fallback string itself still names a real CALENDAR date (the feed day's
 *  anchor date, i.e. what feedDayKey resolves to) — contract.md never says otherwise. */
function formatDayHeadingExpected(date, now = new Date()) {
  const todayFeedKey = feedDayKeyExpected(now);
  const yesterdayFeedKey = feedDayKeyExpected(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const targetFeedKey = feedDayKeyExpected(date);

  if (targetFeedKey === todayFeedKey) return 'Today';
  if (targetFeedKey === yesterdayFeedKey) return 'Yesterday';

  // The displayed weekday/month/day come from the feed day's own anchor date (the calendar
  // date startOfFeedDay(date) floors to), not from `date`'s raw calendar day — these usually
  // agree (any time from 3 AM on), and differ only for a same date's pre-3-AM hours, which
  // the Today/Yesterday branches above already catch before reaching here in every normal
  // case. Reconstruct the anchor date from the key for correctness regardless.
  const [y, m, d] = targetFeedKey.split('-').map(Number);
  const anchor = new Date(y, m - 1, d);
  const sameYear = anchor.getFullYear() === now.getFullYear();
  const opts = sameYear
    ? { weekday: 'long', month: 'long', day: 'numeric' }
    : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
  return new Intl.DateTimeFormat('en-US', opts).format(anchor);
}

/** contract.md §7.4 time formatter: {hour:'numeric', minute:'2-digit'} -> "7:42 AM". */
function formatTimeExpected(date) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

// ---------------------------------------------------------------------------------------------
// v1.1: heatmap bucketing (contract.md §7.8), reimplemented for building expected fixtures/
// assertions in specs/18-heatmap.spec.js. `feeds` is any array of {created_at} (pet already
// filtered by the caller — this function doesn't know about pets).
// ---------------------------------------------------------------------------------------------

function intensityExpected(count, dailyFeedTarget = 4) {
  if (count <= 0) return 0;
  if (count >= dailyFeedTarget) return 4;
  return count; // 1, 2, 3
}

/** contract.md §7.8 buildHeatmap(feeds, now, weeks). Returns the same shape described there:
 *  { weeks: [[cell,...7], ...], each cell { date, feedDayKey, count, inRange, isToday,
 *  intensity } } — flattened to a plain `cells` array too, for convenience in assertions.
 *
 *  ⚠ DELIBERATE DEVIATION from a literal reading of contract.md §7.8 — flagged as a doc bug,
 *  not a QA judgment call; see the ambiguities note in the QA hand-off for the full writeup.
 *  Summary: the contract's literal pseudocode (`start = end - (weeks*7-1) feed-days`, then
 *  grid from "the Sunday on/before `start`" through "the Saturday on/after `end`") only
 *  produces exactly `weeks` rows when `end` (today) itself falls on a Saturday — confirmed
 *  numerically: `now` on a Thursday produces 42 cells/6 rows, not 35/5, because `start` isn't
 *  guaranteed to land on a Sunday, so flooring it back to ITS OWN preceding Sunday can add up
 *  to 6 extra days the "Saturday on/after end" side never needed. That contradicts the
 *  contract's own inline comment on that same line ("so the grid covers exactly `weeks` full
 *  Sun–Sat rows"), spec.md AC-18.1 ("covering HEATMAP_WEEKS (5) weeks") and design.md §4.1
 *  ("HEATMAP_WEEKS (5) rows... current (possibly partial) week last") — all three, including
 *  the contract's own stated intent, agree on "always exactly 5 rows."
 *
 *  This reimplementation instead builds the grid the standard "calendar heatmap" way (as
 *  GitHub's contribution graph does): `gridEnd` = the Saturday on/after `end` (today's own,
 *  possibly-partial week's last day), then `gridStart` = exactly `weeks*7-1` days before
 *  that — which lands on a Sunday automatically for ANY weekday of `end`, giving exactly
 *  `weeks` full rows every day of the week. The data-range boundary (`start`/`inRange`) is
 *  then defined to MATCH that same grid (`start = gridStart`) rather than kept as the
 *  contract's independent, sometimes-misaligned `end - (weeks*7-1)` raw-day count — the two
 *  are within 6 days of each other in the worst case, and anchoring both to the same grid is
 *  what makes "inRange" mean what design.md's prose actually describes (cells within the
 *  rendered 5-week grid, up to today; only today's own row can have real future-padding,
 *  never the earlier rows, since gridStart is already always a Sunday with no flooring
 *  needed). Flagged for the frontend agent to confirm/resolve in `buildHeatmap` itself before
 *  relying on this test file's AC-18.1/18.2 assertions (which assert 5 rows/35 cells, per the
 *  ACs — not 6). */
function buildHeatmapExpected(feeds, now, weeks = 5, dailyFeedTarget = 4) {
  const endKey = feedDayKeyExpected(now);
  const [ey, em, ed] = endKey.split('-').map(Number);
  const end = new Date(ey, em - 1, ed);

  // gridEnd: Saturday on/after `end`. gridStart: exactly weeks*7-1 days before gridEnd —
  // always a Sunday, for any weekday of `end` (see the deviation note above).
  const gridEnd = new Date(end);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
  const gridStart = new Date(gridEnd);
  gridStart.setDate(gridStart.getDate() - (weeks * 7 - 1));
  const startKey = dayKey(gridStart);

  const counts = {};
  for (const f of feeds) {
    const k = feedDayKeyExpected(new Date(f.created_at));
    if (k >= startKey && k <= endKey) counts[k] = (counts[k] || 0) + 1;
  }

  const cells = [];
  for (let d = new Date(gridStart); d <= gridEnd; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d);
    // Every cell in this loop is already >= gridStart (=startKey) by construction — the only
    // out-of-range cells are future dates padding out today's row past `end`.
    const inRange = k <= endKey;
    const count = inRange ? counts[k] || 0 : 0;
    cells.push({
      date: new Date(d),
      feedDayKey: k,
      count,
      inRange,
      isToday: k === endKey,
      intensity: inRange ? intensityExpected(count, dailyFeedTarget) : 0,
    });
  }

  const weeksOut = [];
  for (let i = 0; i < cells.length; i += 7) weeksOut.push(cells.slice(i, i + 7));
  return { weeks: weeksOut, cells, startKey, endKey };
}

/** Accessible-name string for one heatmap cell, per design.md §4.1/§5's documented pattern:
 *  "{Weekday}, {Month} {day}: {n} feed(s)" / "...: no feeds". */
function heatmapCellAriaLabelExpected(cell) {
  const weekdayMonthDay = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(cell.date);
  const countPart = cell.count === 0 ? 'no feeds' : `${cell.count} feed${cell.count === 1 ? '' : 's'}`;
  return `${weekdayMonthDay}: ${countPart}`;
}

// ---------------------------------------------------------------------------------------------
// v1.1: CSV formatting (contract.md §7.9), reimplemented for specs/19-csv-export.spec.js.
// ---------------------------------------------------------------------------------------------

/** RFC 4180 field quoting: wrap in "..." and double internal quotes, only when the field
 *  contains a comma, quote or newline (contract.md §7.9). */
function csvField(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** contract.md §7.9 feedsToCsv(feeds, pet). `feeds` newest-first (as getAllFeedsForExport
 *  resolves) and rows stay in that order (v1.3 — through v1.2 this re-sorted oldest-first).
 *  Returns the full CSV text with \r\n line endings, header included. */
function feedsToCsvExpected(feeds, pet) {
  const header = 'date,pet,time,feeder';
  // v1.3: newest-first, same order as the input (was oldest-first/reversed through v1.2).
  const rows = feeds.map((f) => {
    const date = feedDayKeyExpected(new Date(f.created_at));
    const time = formatTimeExpected(new Date(f.created_at));
    const feeder = f.logged_by || 'Someone';
    return [csvField(date), csvField(pet.name), csvField(time), csvField(feeder)].join(',');
  });
  return [header, ...rows].join('\r\n') + (rows.length ? '\r\n' : '');
}

/** Minimal RFC 4180 parser (field-level only — no header/type inference), for asserting a
 *  downloaded CSV round-trips correctly (AC-19.3's comma/quote feeder-name case). Handles
 *  quoted fields with escaped "" and both \r\n and \n line endings. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // swallow; \n (or end) below closes the row
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** contract.md §7.9 CSV filename: `pumo-feed-log-{pet.slug}-{today's feedDayKey}.csv`. */
function csvFilenameExpected(petSlug, now = new Date()) {
  return `pumo-feed-log-${petSlug}-${feedDayKeyExpected(now)}.csv`;
}

module.exports = {
  dayKey,
  startOfFeedDayExpected,
  feedDayKeyExpected,
  formatDayHeadingExpected,
  formatTimeExpected,
  intensityExpected,
  buildHeatmapExpected,
  heatmapCellAriaLabelExpected,
  csvField,
  feedsToCsvExpected,
  parseCsv,
  csvFilenameExpected,
};
