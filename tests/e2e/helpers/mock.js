// tests/e2e/helpers/mock.js
// GET-response mocking for the home-data endpoints, matched on contract.md §6.A/B's exact
// query shapes. Used for tests that assert on *display/formatting* (headline text, row
// count, counter text, guard styling) where the app's actual behavior must be deterministic
// regardless of real, concurrent household data that may exist in the shared production
// Supabase project. Tests that need to prove the real write/read path end-to-end (F3, F5,
// F6, F13, ...) use real REST calls instead (see helpers/rest.js) — this file is only for
// isolating rendering logic. Mirrors the approach tasks.md §2 already prescribes for the
// zero-feed states S1/S10 ("intercept the GETs to return [] instead"), generalized to any
// known recent/todayCount fixture.

'use strict';

const { SUPABASE_URL } = require('../config');

const FEEDS_GLOB = `${SUPABASE_URL}/rest/v1/feeds**`;

/** Builds a Feed-shaped object with created_at = (real now - agoMs). */
function fakeFeed({ agoMs = 0, loggedBy = 'QA-test', id } = {}) {
  return {
    id: id || `00000000-0000-4000-8000-${String(Date.now() % 1e12).padStart(12, '0')}`,
    created_at: new Date(Date.now() - agoMs).toISOString(),
    logged_by: loggedBy,
  };
}

/**
 * Routes the two home-data GET calls (contract.md §6.A "last 3" and §6.B "today's count")
 * to fixed responses. `recent` is an array of ≤3 Feed-like objects (newest first);
 * `todayCount` is the integer the today-count GET should resolve to (only its length
 * matters — see contract.md §6.B, "todayCount is the array's length").
 * Any other request (POST/PATCH/history GETs) passes through untouched.
 */
async function mockHomeData(page, { recent = [], todayCount = 0 } = {}) {
  return mockHomeDataDynamic(page, () => ({ recent, todayCount }));
}

/**
 * Like mockHomeData, but calls `stateProvider()` fresh on every matching request instead of
 * fixing the response once. Lets a test change what the *next* fetch/refresh sees (e.g. for
 * AC-6.3's "stale data -> refetch sees a new guard-triggering feed") just by mutating a
 * closure variable, with no need to re-register routes.
 */
async function mockHomeDataDynamic(page, stateProvider) {
  await page.route(FEEDS_GLOB, async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') return route.continue();
    let u;
    try {
      u = new URL(req.url());
    } catch {
      return route.continue();
    }
    const select = u.searchParams.get('select') || '';
    const limit = u.searchParams.get('limit');
    const { recent = [], todayCount = 0 } = stateProvider() || {};

    // Last-3 feeds: select=id,created_at,logged_by ... limit=3
    if (select.replace(/\s/g, '') === 'id,created_at,logged_by' && limit === '3') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(recent.slice(0, 3)),
      });
    }
    // Today's count: select=id ... created_at=gte....  (no limit param)
    if (select === 'id' && u.searchParams.has('created_at') && !limit) {
      const arr = Array.from({ length: todayCount }, (_, i) => ({ id: `mock-count-${i}` }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(arr) });
    }
    return route.continue();
  });
}

/** Convenience: mock a "zero feeds" home state (S1), matching tasks.md §2's prescribed technique. */
async function mockZeroFeeds(page) {
  return mockHomeData(page, { recent: [], todayCount: 0 });
}

/** Mocks the history first-page GET (contract.md §6.E) to a fixed feed list / hasMore. */
async function mockHistoryFirstPage(page, feeds = []) {
  await page.route(FEEDS_GLOB, async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') return route.continue();
    let u;
    try {
      u = new URL(req.url());
    } catch {
      return route.continue();
    }
    const select = u.searchParams.get('select') || '';
    const limit = u.searchParams.get('limit');
    if (select.replace(/\s/g, '') === 'id,created_at,logged_by' && limit === '100') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feeds) });
    }
    return route.continue();
  });
}

/**
 * Fulfills POST (and, if requested, PATCH) to the feeds endpoint with a synthesized success
 * response, entirely locally — never touching the real network. This is NOT a substitute for
 * proving the real write path (that needs the actual Supabase project, e.g. specs/03-logging
 * and friends) — it exists only so screenshot-only evidence for states that follow a
 * successful log/undo/delete (design.md §6 "saving", "logged", the undo notice, ...) can
 * still be captured when the real project is unreachable (this sandbox's egress policy; see
 * qa-report.md). `postDelayMs` optionally delays the POST's fulfillment, to hold the UI in
 * its `saving` state long enough for a screenshot.
 */
async function mockSuccessfulWrites(page, { postDelayMs = 0 } = {}) {
  await page.route(FEEDS_GLOB, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      if (postDelayMs) await new Promise((r) => setTimeout(r, postDelayMs));
      let body = {};
      try {
        body = JSON.parse(req.postData() || '{}');
      } catch {
        /* ignore */
      }
      const row = {
        id: body.id || `00000000-0000-4000-8000-${String(Date.now() % 1e12).padStart(12, '0')}`,
        created_at: new Date().toISOString(),
        logged_by: body.logged_by ?? null,
        deleted_at: null,
      };
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([row]) });
    }
    if (req.method() === 'PATCH') {
      let body = {};
      try {
        body = JSON.parse(req.postData() || '{}');
      } catch {
        /* ignore */
      }
      const u = new URL(req.url());
      const idMatch = (u.searchParams.get('id') || '').match(/^eq\.(.+)$/);
      const row = { id: idMatch ? idMatch[1] : 'unknown', deleted_at: body.deleted_at || new Date().toISOString() };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) });
    }
    return route.continue();
  });
}

module.exports = {
  FEEDS_GLOB,
  fakeFeed,
  mockHomeData,
  mockHomeDataDynamic,
  mockZeroFeeds,
  mockHistoryFirstPage,
  mockSuccessfulWrites,
};
