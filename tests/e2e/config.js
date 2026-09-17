// tests/e2e/config.js
// Central config for the QA suite. Values that are safe to hardcode (the publishable
// key is *meant* to be public — see contract.md §4) come from docs/architecture.md §8.
// Values that only exist once the app is deployed (LIVE_URL, the build.txt marker) are
// read from the environment so the orchestrator can hand them to us after "DEPLOYED: ...".
//
// Per tasks.md §2 "Setup", nothing here is a secret. Never add a service_role or
// secret key to this file.

'use strict';

// --- Supabase project (architecture.md §8, filled in by the frontend agent's Task 1) ---
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://dufyzxtrhdcwrebagsfs.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_1UHmmXOcj6uhnQJRSFKMEQ_qjOzVwJl';

// --- Live deploy (given to us later by the orchestrator as "DEPLOYED: <LIVE_URL>, build.txt=<value>") ---
// Falls back to a local static server so the suite is at least listable/dry-runnable
// before a real deploy exists. Full-suite runs MUST pass LIVE_URL explicitly.
const LIVE_URL = (process.env.LIVE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const EXPECTED_BUILD_TXT = process.env.BUILD_TXT || null;

// --- Chromium install (per orchestrator instructions: do NOT run `playwright install`) ---
const CHROMIUM_EXECUTABLE_PATH =
  process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';

// --- Constants mirrored from contract.md §7.1 ---
// QA must NOT import frontend/js/constants.js (we don't own frontend/, and it may not
// exist yet). These values are copied from contract.md and must be kept in sync with it
// by hand; a mismatch here is itself something worth flagging in the report.
const CONSTANTS = Object.freeze({
  RECENT_FEED_GUARD_MS: 2 * 60 * 60 * 1000, // 7_200_000
  DAILY_FEED_TARGET: 4,
  UNDO_WINDOW_MS: 10_000,
  ARM_TIMEOUT_MS: 6_000,
  LOGGED_FLASH_MS: 2_000,
  REMOVED_NOTICE_MS: 3_000,
  REQUEST_TIMEOUT_MS: 10_000,
  STALE_AFTER_MS: 60_000,
  TICK_MS: 30_000,
  FOCUS_REFRESH_DEBOUNCE_MS: 2_000,
  RECENT_LIST_SIZE: 3,
  HISTORY_PAGE_SIZE: 100,
  NAME_MAX_LENGTH: 20,
  PAUSED_HINT_AFTER_FAILURES: 2,
  STORAGE_KEYS: Object.freeze({
    loggerName: 'pumo.loggerName',
    namePromptDone: 'pumo.namePromptDone',
  }),
});

// Primary timezone for most scenarios (tasks.md §2 Setup).
const PRIMARY_TIMEZONE = 'America/Los_Angeles';

// Test-data marker required by tasks.md §0 and §2.
const QA_LOGGED_BY = 'QA-test';

module.exports = {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  LIVE_URL,
  EXPECTED_BUILD_TXT,
  CHROMIUM_EXECUTABLE_PATH,
  CONSTANTS,
  PRIMARY_TIMEZONE,
  QA_LOGGED_BY,
};
