// tests/e2e/helpers/time.js
// Time-zone and clock helpers per tasks.md §2 "Environment" and "Clock control".

'use strict';

// One IANA zone per whole-hour UTC offset from -11 to +12 (covers the practical range;
// good enough to always find a "daylight" zone for the daytime-scenario requirement).
const OFFSET_ZONES = [
  'Pacific/Midway', 'Pacific/Honolulu', 'Pacific/Marquesas', 'America/Anchorage',
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Halifax', 'America/Sao_Paulo', 'Atlantic/South_Georgia', 'Atlantic/Azores',
  'UTC', 'Europe/Berlin', 'Europe/Athens', 'Europe/Moscow', 'Asia/Dubai',
  'Asia/Karachi', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Shanghai', 'Asia/Tokyo',
  'Australia/Sydney', 'Pacific/Noumea', 'Pacific/Auckland',
];

/** Local hour (0-23) in the given IANA zone, for a given real Date. */
function localHourIn(timeZone, date = new Date()) {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).format(date);
  // "24" shows up for midnight in some locales/impls; normalize.
  const h = parseInt(hourStr, 10);
  return h === 24 ? 0 : h;
}

/**
 * Pick an IANA timezoneId where the current real time is between 06:00 and 18:00 local,
 * per tasks.md §2: "For scenarios that must stay inside one local day (AC-7.2, 8.3, 8.4),
 * pick a timezoneId where the current real time is between 06:00 and 18:00 local, and
 * record which one was used."
 *
 * Prefers the suite's primary timezone (America/Los_Angeles) when it already qualifies,
 * so most runs don't need a second timezone at all.
 */
function pickDaytimeTimezone(primaryZone = 'America/Los_Angeles', now = new Date()) {
  const primaryHour = localHourIn(primaryZone, now);
  if (primaryHour >= 6 && primaryHour < 18) {
    return { timezoneId: primaryZone, localHour: primaryHour };
  }
  for (const zone of OFFSET_ZONES) {
    const h = localHourIn(zone, now);
    if (h >= 6 && h < 18) {
      return { timezoneId: zone, localHour: h };
    }
  }
  // Should be unreachable (some zone is always in 06:00-18:00), but fail loudly if so.
  throw new Error('pickDaytimeTimezone: no candidate zone found in the 06:00-18:00 window');
}

/** ms helpers for readability in specs. */
const MS = {
  seconds: (n) => n * 1000,
  minutes: (n) => n * 60 * 1000,
  hours: (n) => n * 60 * 60 * 1000,
  days: (n) => n * 24 * 60 * 60 * 1000,
};

module.exports = { localHourIn, pickDaytimeTimezone, MS, OFFSET_ZONES };
