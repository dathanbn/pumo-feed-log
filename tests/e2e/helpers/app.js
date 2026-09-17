// tests/e2e/helpers/app.js
// Page-level helpers: navigation, localStorage seeding, visibility/focus simulation.

'use strict';

const { LIVE_URL, CONSTANTS } = require('../config');

const HOME_URL = `${LIVE_URL}/index.html`;
const HOME_URL_ROOT = `${LIVE_URL}/`;
const HISTORY_URL = `${LIVE_URL}/history.html`;

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

async function gotoHome(page) {
  await page.goto(HOME_URL_ROOT, { waitUntil: 'load' });
}

async function gotoHistory(page) {
  await page.goto(HISTORY_URL, { waitUntil: 'load' });
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
  seedLocalStorage,
  seedQaLoggerName,
  gotoHome,
  gotoHistory,
  simulateHiddenThenVisible,
  simulateHidden,
};
