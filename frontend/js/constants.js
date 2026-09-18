export const RECENT_FEED_GUARD_MS = 2 * 60 * 60 * 1000; // 7_200_000 ms. Dathan's 2-hour window (NOT 60 min)
export const DAILY_FEED_TARGET = 4;                     // "n of 4 today"; guard applies when n >= 4
export const DAY_BOUNDARY = 'feed-day-3am';             // documentation: the feed day starts 03:00 in the viewing phone's time zone (v1.1; was 'local-midnight')
export const FEED_DAY_START_HOUR = 3;                   // the hour (0-23, local time) a feed day starts and the previous one ends
export const UNDO_WINDOW_MS = 10_000;
export const ARM_TIMEOUT_MS = 6_000;
export const LOGGED_FLASH_MS = 2_000;
export const REMOVED_NOTICE_MS = 3_000;
export const REQUEST_TIMEOUT_MS = 10_000;
export const STALE_AFTER_MS = 60_000;
export const TICK_MS = 30_000;
export const FOCUS_REFRESH_DEBOUNCE_MS = 2_000;
export const RECENT_LIST_SIZE = 3;
export const HISTORY_PAGE_SIZE = 100;
export const NAME_MAX_LENGTH = 20;
export const PAUSED_HINT_AFTER_FAILURES = 2;
export const HEATMAP_WEEKS = 5;                         // weeks of calendar shown, including the current partial week
export const DEFAULT_PET_SLUG = 'pumo';                 // home pet when the URL names no pet, or names an unknown one
export const EDIT_FUTURE_GRACE_MS = 5 * 60 * 1000;      // v1.2: matches the DB's feeds_created_at_not_future check exactly
export const STORAGE_KEYS = Object.freeze({
  loggerName: 'pumo.loggerName',
  namePromptDone: 'pumo.namePromptDone', // '1' after Save or Skip
});
