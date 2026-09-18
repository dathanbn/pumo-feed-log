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
//
// v1.1 additions (contract.md §7.1): FEED_DAY_START_HOUR, HEATMAP_WEEKS, DEFAULT_PET_SLUG.
// DAY_BOUNDARY itself changed value from 'local-midnight' to 'feed-day-3am' — it's a
// documentation-only constant (not used in any comparison), so it isn't mirrored here, but
// note it if it's ever added: the frontend's constants.js should read 'feed-day-3am', not
// the old value, and a QA source-check could catch a build that forgot to update it.
const CONSTANTS = Object.freeze({
  RECENT_FEED_GUARD_MS: 2 * 60 * 60 * 1000, // 7_200_000
  DAILY_FEED_TARGET: 4,
  FEED_DAY_START_HOUR: 3, // v1.1: the feed day starts 03:00 local, not midnight (spec.md F8)
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
  HEATMAP_WEEKS: 5, // v1.1: weeks of calendar shown on history.html's heatmap (spec.md F18)
  DEFAULT_PET_SLUG: 'pumo', // v1.1: home pet when the URL names no pet, or an unknown one
  STORAGE_KEYS: Object.freeze({
    loggerName: 'pumo.loggerName',
    namePromptDone: 'pumo.namePromptDone',
  }),
});

// Primary timezone for most scenarios (tasks.md §2 Setup).
const PRIMARY_TIMEZONE = 'America/Los_Angeles';

// Test-data marker required by tasks.md §0 and §2.
const QA_LOGGED_BY = 'QA-test';

// --- Pets (v1.1, contract.md §1/§2 seed data + architecture.md §10 URL scheme) ---
// The 3 rows the migration seeds. `id` is unknown until the migration actually runs against
// the live project (gen_random_uuid() at insert time) — DO NOT hardcode a uuid here. Anything
// needing a real pet id must resolve it live via helpers/rest.js's getPets()/getPetIdBySlug(),
// which fetch-and-cache from GET /rest/v1/pets. This list exists for iterating slugs, building
// URLs (helpers/app.js) and populating mocked `pets` responses (helpers/mock.js) before the
// schema exists at all.
const PETS = Object.freeze([
  Object.freeze({ slug: 'pumo', name: 'Pumo', species: 'cat', sort_order: 0, photo_url: 'assets/pumo.jpg' }),
  Object.freeze({ slug: 'zuumi', name: 'Zuumi', species: 'cat', sort_order: 1, photo_url: null }),
  Object.freeze({ slug: 'banh-mi', name: 'Banh Mi', species: 'dog', sort_order: 2, photo_url: null }),
]);
const PET_SLUGS = Object.freeze(PETS.map((p) => p.slug));
const DEFAULT_PET_SLUG = 'pumo';
const NON_DEFAULT_PET_SLUGS = Object.freeze(PET_SLUGS.filter((s) => s !== DEFAULT_PET_SLUG));

module.exports = {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  LIVE_URL,
  EXPECTED_BUILD_TXT,
  CHROMIUM_EXECUTABLE_PATH,
  CONSTANTS,
  PRIMARY_TIMEZONE,
  QA_LOGGED_BY,
  PETS,
  PET_SLUGS,
  DEFAULT_PET_SLUG,
  NON_DEFAULT_PET_SLUGS,
};
