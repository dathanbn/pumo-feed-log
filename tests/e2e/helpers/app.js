// tests/e2e/helpers/app.js
// Page-level helpers: navigation, localStorage seeding, visibility/focus simulation.
//
// v1.1 (contract.md §7.10 `pathForPet`, architecture.md §10): every pet except the default
// (Pumo) is reached via `?pet={slug}` on the SAME index.html/history.html — there is no
// separate URL path per pet. gotoHome/gotoHistory below take an optional `petSlug` and build
// that query string themselves, mirroring pathForPet exactly (no query string for the default
// pet, `?pet={slug}` otherwise) — this file must not hand-write a different shape.

'use strict';

const { LIVE_URL, CONSTANTS, DEFAULT_PET_SLUG } = require('../config');

const HOME_URL = `${LIVE_URL}/index.html`;
const HOME_URL_ROOT = `${LIVE_URL}/`;
const HISTORY_URL = `${LIVE_URL}/history.html`;

/** Mirrors contract.md §7.10 `pathForPet(slug, page)`. Returns a URL relative to LIVE_URL
 *  (e.g. `index.html`, `index.html?pet=zuumi`, `history.html?pet=banh-mi`). Not exported as
 *  "pathForPet" itself — this is QA's own reimplementation for building request URLs, not the
 *  app's function (we don't import frontend/js/logic.js — see selectors.js's header note). */
function urlForPet(petSlug = DEFAULT_PET_SLUG, page = 'index.html') {
  return petSlug === DEFAULT_PET_SLUG ? page : `${page}?pet=${encodeURIComponent(petSlug)}`;
}

/**
 * Seed localStorage BEFORE any page script runs, via an init script on the context.
 * Must be called before the first page.goto() in that context/page.
 *   opts.loggerName: string | null  -> pumo.loggerName
 *   opts.namePromptDone: boolean    -> pumo.namePromptDone = '1' when true
 */
async function seedLocalStorage(pageOrContext, { loggerName, namePromptDone } = {}) {
  const keys = CONSTANTS.STORAGE_KEYS;
  await pageOrContext.addInitScript(
    ({ keys, loggerName, namePromptDone }) => {
      try {
        if (loggerName !== undefined && loggerName !== null) {
          window.localStorage.setItem(keys.loggerName, loggerName);
        }
        if (namePromptDone) {
          window.localStorage.setItem(keys.namePromptDone, '1');
        }
      } catch (e) {
        // localStorage unavailable — tests targeting AC-14.6 rely on this being swallowed.
      }
    },
    { keys, loggerName: loggerName ?? null, namePromptDone: !!namePromptDone }
  );
}

/** Convenience: a context/page pre-seeded with the QA-test logger name (tasks.md §2). */
async function seedQaLoggerName(pageOrContext, name = 'QA-test') {
  await seedLocalStorage(pageOrContext, { loggerName: name, namePromptDone: true });
}

/** `petSlug` omitted or DEFAULT_PET_SLUG -> the bare root URL (unchanged from v1, AC-17.1:
 *  "no ?pet= query string shows Pumo's log ... identical to pre-v1.1"). Any other slug (or a
 *  deliberately unrecognized one, for AC-17.2's fallback case) appends `?pet=`. */
async function gotoHome(page, petSlug = DEFAULT_PET_SLUG) {
  const url = petSlug === DEFAULT_PET_SLUG ? HOME_URL_ROOT : `${LIVE_URL}/${urlForPet(petSlug)}`;
  await page.goto(url, { waitUntil: 'load' });
}

async function gotoHistory(page, petSlug = DEFAULT_PET_SLUG) {
  const url = `${LIVE_URL}/${urlForPet(petSlug, 'history.html')}`;
  await page.goto(url, { waitUntil: 'load' });
}

/**
 * Simulates the app going to the background and coming back, per tasks.md §2
 * "Visibility and focus": dispatch visibilitychange(hidden) -> visibilitychange(visible)
 * -> focus -> pageshow(persisted:true). Use when a real tab switch isn't available headless.
 *
 * A real page's own initial load already fires a native `pageshow`, which starts
 * onFocusRefresh's FOCUS_REFRESH_DEBOUNCE_MS (2s, architecture.md §4) window on that first
 * call. Calling this again inside that window would get silently swallowed by the app's own
 * debounce (not a bug — that's the debounce working as designed) and produce a false
 * "focus refresh didn't happen" result that has nothing to do with the thing under test. So
 * this always waits out the debounce window first, guaranteeing the simulated event actually
 * reaches the app's callback. Callers don't need to (and shouldn't have to) know this.
 */
async function simulateHiddenThenVisible(page) {
  await page.waitForTimeout(CONSTANTS.FOCUS_REFRESH_DEBOUNCE_MS + 100);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow', { bubbles: true }));
    // pageshow's `persisted` is read-only on the real event; construct via PageTransitionEvent
    // when available so `persisted: true` actually reaches listeners that check it.
    try {
      const evt = new PageTransitionEvent('pageshow', { persisted: true });
      window.dispatchEvent(evt);
    } catch (e) {
      /* PageTransitionEvent not constructible in this engine; the plain Event above still fires. */
    }
  });
}

/** Just hides the page (for AC-7.4's "immediately when the page is hidden" case). */
async function simulateHidden(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

module.exports = {
  HOME_URL,
  HOME_URL_ROOT,
  HISTORY_URL,
  urlForPet,
  seedLocalStorage,
  seedQaLoggerName,
  gotoHome,
  gotoHistory,
  simulateHiddenThenVisible,
  simulateHidden,
};
