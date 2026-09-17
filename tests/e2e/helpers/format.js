// tests/e2e/helpers/format.js
// QA-side reimplementations of contract.md §7.4's day-heading rule, used ONLY to build the
// expected strings a test asserts against. This is not imported by (and has no relationship
// to) the app's own logic.js — it exists so tests don't have to hardcode calendar-dependent
// strings like weekday names.

'use strict';

function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** contract.md §7.4 formatDayHeading: Today / Yesterday / "Monday, September 14[, 2025]". */
function formatDayHeadingExpected(date, now = new Date()) {
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayStart = startOf(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const target = startOf(date);

  if (dayKey(target) === dayKey(todayStart)) return 'Today';
  if (dayKey(target) === dayKey(yesterdayStart)) return 'Yesterday';

  const sameYear = target.getFullYear() === now.getFullYear();
  const opts = sameYear
    ? { weekday: 'long', month: 'long', day: 'numeric' }
    : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
  return new Intl.DateTimeFormat('en-US', opts).format(target);
}

module.exports = { formatDayHeadingExpected, dayKey };
