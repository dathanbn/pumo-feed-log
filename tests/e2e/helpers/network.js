// tests/e2e/helpers/network.js
// Fault-injection helpers per tasks.md §2 "Fault injection techniques".

'use strict';

const { SUPABASE_URL } = require('../config');

const FEEDS_GLOB = `${SUPABASE_URL}/rest/v1/feeds**`;

/** Matches any request to the feeds REST endpoint (any method/query string). */
const feedsUrlPattern = FEEDS_GLOB;

/** Delay every matching request by `ms`, then let it through. Latency injection.
 *  Pass `methodFilter` (e.g. 'POST') to only delay that HTTP method; others pass straight through. */
async function addLatency(page, ms = 3000, { urlPattern = feedsUrlPattern, methodFilter = null } = {}) {
  await page.route(urlPattern, async (route) => {
    if (methodFilter && route.request().method() !== methodFilter) return route.continue();
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

/** Abort every matching request outright (simulates offline/dropped connection). */
async function abortRequests(page, { urlPattern = feedsUrlPattern, methodFilter = null, errorCode = 'failed' } = {}) {
  await page.route(urlPattern, (route) => {
    if (methodFilter && route.request().method() !== methodFilter) return route.continue();
    return route.abort(errorCode);
  });
}

/** Fulfill every matching request with an HTTP 5xx (simulates server failure). */
async function failWith5xx(page, { status = 503, urlPattern = feedsUrlPattern, methodFilter = null } = {}) {
  await page.route(urlPattern, (route) => {
    if (methodFilter && route.request().method() !== methodFilter) return route.continue();
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'injected failure' }),
    });
  });
}

/**
 * "Lost response" fault (contract.md §8 / AC-4.4): the request really reaches the database
 * (so a row IS created) but the client never sees the response. Only the first matching
 * request is affected; subsequent ones pass through normally (so a retry succeeds).
 */
function lostResponseOnFirstMatch(page, urlPattern = feedsUrlPattern, methodFilter = 'POST') {
  let used = false;
  return page.route(urlPattern, async (route) => {
    const req = route.request();
    if (used || (methodFilter && req.method() !== methodFilter)) {
      await route.continue();
      return;
    }
    used = true;
    await route.fetch(); // actually performs the request against the real server
    await route.abort('failed'); // ...but the client never sees a response
  });
}

/**
 * Timeout fault: the request never resolves at all. Pair with the page clock's
 * `fastForward`/advance past REQUEST_TIMEOUT_MS so the app's own AbortController fires.
 * Returns a function to call if you need to release pending routes (rare; usually the
 * test ends before it matters).
 */
async function neverRespond(page, { urlPattern = feedsUrlPattern, methodFilter = null } = {}) {
  await page.route(urlPattern, (route) => {
    if (methodFilter && route.request().method() !== methodFilter) return route.continue();
    // Intentionally never calls route.fulfill/continue/abort.
  });
}

/**
 * Fails only the first matching request (abort or 5xx), then lets every later one through
 * normally. Useful for "the confirmed save fails once, then a retry succeeds" scenarios
 * (AC-4.3's retry-then-success, AC-4.5's retry-not-reguarded, AC-9.4/10.4's undo/delete retry).
 */
function failFirstThenAllow(page, { urlPattern = feedsUrlPattern, methodFilter = 'POST', mode = 'abort', status = 503 } = {}) {
  let used = false;
  return page.route(urlPattern, async (route) => {
    const req = route.request();
    if (used || (methodFilter && req.method() !== methodFilter)) {
      return route.continue();
    }
    used = true;
    if (mode === '5xx') {
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ message: 'injected failure' }) });
    }
    return route.abort('failed');
  });
}

/** Removes all route handlers so subsequent requests behave normally. */
async function clearRoutes(page, urlPattern = feedsUrlPattern) {
  await page.unroute(urlPattern);
}

/** context.setOffline(true) wrapper, matching tasks.md's exact recommended API. */
async function goOffline(context) {
  await context.setOffline(true);
}
async function goOnline(context) {
  await context.setOffline(false);
}

module.exports = {
  feedsUrlPattern,
  addLatency,
  abortRequests,
  failWith5xx,
  lostResponseOnFirstMatch,
  failFirstThenAllow,
  neverRespond,
  clearRoutes,
  goOffline,
  goOnline,
};
