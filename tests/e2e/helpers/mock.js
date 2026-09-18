// tests/e2e/helpers/mock.js
// GET-response mocking for the home-data endpoints, matched on contract.md §6.A/B's exact
// query shapes. Used for tests that assert on *display/formatting* (headline text, row
// count, counter text, guard styling) where the app's actual behavior must be deterministic
// regardless of real, concurrent household data that may exist in the shared production
// Supabase project. Tests that need to prove the real write/read path end-to-end against the
// live database (F3, F5, F6, F13, and any AC whose claim is specifically about a *database*
// effect — e.g. "exactly one row exists", a real cross-device sync) still use real REST calls
// (see helpers/rest.js) — no amount of mocking substitutes for that. But plenty of ACs claim
// something about pure *client* behavior instead (request counts, UI state before/after a
// response resolves, retry/conflict handling, CSV/pagination logic) — those don't need a real
// database round trip at all, only a plausible-shaped response, so this file also mocks
// POST/PATCH (mockSuccessfulWrites, mockLostResponseThenConflict) and multi-page GET sequences
// (mockHistoryPages) for exactly those cases. Mirrors the approach tasks.md §2 already
// prescribes for the zero-feed states S1/S10 ("intercept the GETs to return [] instead"),
// generalized to any known recent/todayCount fixture, request count, or page sequence.

'use strict';

const { SUPABASE_URL, PETS, DEFAULT_PET_SLUG } = require('../config');

const FEEDS_GLOB = `${SUPABASE_URL}/rest/v1/feeds**`;
const PETS_GLOB = `${SUPABASE_URL}/rest/v1/pets**`;

// v1.1: a fixed set of synthetic (but stable, well-formed) pet ids for mocked tests that need
// something for `fakeFeed`'s `pet_id` or `mockPets`' rows to point at, without ever hitting
// the real `pets` table (which may not exist yet). NOT the real ids the live migration will
// generate — anything asserting against real ids must go through helpers/rest.js's
// getPets()/getPetIdBySlug() instead. Keyed by slug for readability at call sites.
const MOCK_PET_IDS = Object.freeze({
  pumo: '00000000-0000-4000-9000-000000000000',
  zuumi: '00000000-0000-4000-9000-000000000001',
  'banh-mi': '00000000-0000-4000-9000-000000000002',
});

/** Mock Pet rows (contract.md §5/§6.G shape), built from config.js's PETS fixture list plus
 *  MOCK_PET_IDS. Pass `overrides` (array, same length/order as PETS) to tweak individual
 *  fields, e.g. giving Zuumi a photo_url for a specific test. */
function mockPetRows(overrides = []) {
  return PETS.map((p, i) => ({
    id: MOCK_PET_IDS[p.slug],
    slug: p.slug,
    name: p.name,
    species: p.species,
    sort_order: p.sort_order,
    photo_url: p.photo_url,
    ...(overrides[i] || {}),
  }));
}

/** Routes GET /rest/v1/pets (contract.md §6.G) to a fixed list. Defaults to the real 3-pet
 *  seed data (mockPetRows()). Needed by every mocked v1.1 test, since the app resolves the
 *  selected pet via getPets() before rendering anything (architecture.md §4 "Home state").
 *  Any other method to /pets (there shouldn't be any — contract.md §3 "no grant and no
 *  policy") passes through untouched so a stray write attempt still hits the real 401/403. */
async function mockPets(page, pets = mockPetRows()) {
  await page.route(PETS_GLOB, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pets) });
  });
  return pets;
}

/** Builds a Feed-shaped object with created_at = (real now - agoMs). v1.1: includes pet_id,
 *  defaulting to the mocked Pumo id (MOCK_PET_IDS.pumo) — pass `petSlug` or `petId` to build
 *  a feed for a different pet in a multi-pet-scoping test. */
function fakeFeed({ agoMs = 0, loggedBy = 'QA-test', id, petSlug = DEFAULT_PET_SLUG, petId } = {}) {
  return {
    id: id || `00000000-0000-4000-8000-${String(Date.now() % 1e12).padStart(12, '0')}`,
    pet_id: petId || MOCK_PET_IDS[petSlug] || MOCK_PET_IDS[DEFAULT_PET_SLUG],
    created_at: new Date(Date.now() - agoMs).toISOString(),
    logged_by: loggedBy,
  };
}

/**
 * Routes getPets (contract.md §6.G), then the two home-data GET calls (contract.md §6.A
 * "last 3" and §6.B "today's count") to fixed responses. `recent` is an array of ≤3
 * Feed-like objects (newest first); `todayCount` is the integer the today-count GET should
 * resolve to (only its length matters — see contract.md §6.B, "todayCount is the array's
 * length"). `pets` defaults to the real 3-pet seed data (mockPetRows()).
 * Any other request (POST/PATCH/history GETs) passes through untouched.
 */
async function mockHomeData(page, { recent = [], todayCount = 0, pets } = {}) {
  await mockPets(page, pets);
  return mockHomeDataDynamic(page, () => ({ recent, todayCount }));
}

/**
 * Like mockHomeData, but calls `stateProvider()` fresh on every matching request instead of
 * fixing the response once. Lets a test change what the *next* fetch/refresh sees (e.g. for
 * AC-6.3's "stale data -> refetch sees a new guard-triggering feed") just by mutating a
 * closure variable, with no need to re-register routes. Does NOT itself mock getPets() — call
 * mockPets(page) separately first (mockHomeData does this for you).
 *
 * v1.1: contract.md §6.A/§6.B's select list now includes `pet_id`
 * (`select=id,pet_id,created_at,logged_by`), and both queries carry a `pet_id=eq.{id}` filter.
 * Matched on the select string only (not the pet_id value) — a real multi-pet scoping test
 * needs `state.recent`'s objects to already carry the RIGHT pet_id (see fakeFeed's petSlug/
 * petId option) and should assert on the query string itself (see specs/17-pets.spec.js)
 * rather than relying on this mock to reject a mismatched pet_id, which it doesn't do.
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
    const selectNorm = select.replace(/\s/g, '');
    const limit = u.searchParams.get('limit');
    const { recent = [], todayCount = 0 } = stateProvider() || {};

    // Last-3 feeds: select=id,pet_id,created_at,logged_by ... limit=3
    // (v1 shape `id,created_at,logged_by` also matched, in case a build hasn't added pet_id
    // to the select list yet — that omission is itself worth flagging as a defect, not
    // something this mock should silently paper over by refusing to match at all.)
    if ((selectNorm === 'id,pet_id,created_at,logged_by' || selectNorm === 'id,created_at,logged_by') && limit === '3') {
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

/**
 * Mocks getPets() plus the history-page GET (contract.md §6.E), paging through `pages`
 * (an array of feed arrays, each up to HISTORY_PAGE_SIZE) on successive requests. `pets`
 * defaults to the real 3-pet seed data. Same select-string tolerance note as
 * mockHomeDataDynamic above (matches both the v1.1 and bare pre-v1.1 select shapes).
 *
 * Paging model: a request with no `created_at=lt....` cursor (`before` absent) always starts
 * a fresh walk at `pages[0]` — this covers both a page (re)load's own first-page GET AND a
 * fully independent `getAllFeedsForExport` walk that a CSV-download click kicks off afterward
 * (contract.md §6.F.2 starts that walk with `before` unset, same as the on-screen first page).
 * Each subsequent request that DOES carry a `before` cursor advances one step further into
 * `pages`, clamped to the last entry once exhausted — so "Show older feeds" (AC-12.3) and CSV
 * paging (AC-19.1/19.2) both walk the same array correctly, including when they happen in the
 * same test. Pass a single-array `pages` (`[feeds]`) for the common one-page case — this is
 * what `mockHistoryFirstPage` below does.
 */
async function mockHistoryPages(page, pages = [[]], { pets, delayMs = 0 } = {}) {
  await mockPets(page, pets);
  let cursorIndex = -1;
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
    const selectNorm = select.replace(/\s/g, '');
    const limit = u.searchParams.get('limit');
    if ((selectNorm === 'id,pet_id,created_at,logged_by' || selectNorm === 'id,created_at,logged_by') && limit === '100') {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const hasBefore = u.searchParams.has('created_at'); // only the "older" cursor sets this
      cursorIndex = hasBefore ? cursorIndex + 1 : 0;
      const feeds = pages[Math.min(cursorIndex, pages.length - 1)] || [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feeds) });
    }
    return route.continue();
  });
}

/** Single-page convenience wrapper around mockHistoryPages (the common case: one fixed feed
 *  list, no "Show older"/export pagination under test). */
async function mockHistoryFirstPage(page, feeds = [], { pets, delayMs } = {}) {
  return mockHistoryPages(page, [feeds], { pets, delayMs });
}

/**
 * Mocks getPets() plus BOTH home-data GETs (contract.md §6.A/B), scoped per pet by reading the
 * real `pet_id=eq.{id}` query param a v1.1 build must send — unlike mockHomeData/
 * mockHomeDataDynamic above (which return the same fixture regardless of which pet_id was
 * requested, by design — see their own doc comments), this is what actually proves cross-pet
 * independence (AC-17.4): two different pets' fixtures, and a request for pet A's data can
 * never accidentally receive pet B's. `dataBySlug` is `{ [petSlug]: { recent, todayCount } }`;
 * a slug with no entry (or a request whose pet_id doesn't resolve to a known pet) gets an
 * empty/zero fixture rather than failing the route.
 */
async function mockHomeDataPerPet(page, dataBySlug = {}, { pets } = {}) {
  const petRows = await mockPets(page, pets);
  const slugById = new Map(petRows.map((p) => [p.id, p.slug]));
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
    const selectNorm = select.replace(/\s/g, '');
    const limit = u.searchParams.get('limit');
    const petIdParam = u.searchParams.get('pet_id') || '';
    const idMatch = petIdParam.match(/^eq\.(.+)$/);
    const slug = idMatch ? slugById.get(idMatch[1]) : undefined;
    const state = (slug && dataBySlug[slug]) || { recent: [], todayCount: 0 };

    if ((selectNorm === 'id,pet_id,created_at,logged_by' || selectNorm === 'id,created_at,logged_by') && limit === '3') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify((state.recent || []).slice(0, 3)),
      });
    }
    if (select === 'id' && u.searchParams.has('created_at') && !limit) {
      const arr = Array.from({ length: state.todayCount || 0 }, (_, i) => ({ id: `mock-count-${slug || 'unknown'}-${i}` }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(arr) });
    }
    return route.continue();
  });
}

/**
 * Like mockHomeDataDynamic but for the history-page GET (contract.md §6.E): calls
 * `stateProvider()` fresh on every matching first-page request (no `before` cursor), so a test
 * can change what the *next* focus-refresh sees — e.g. AC-18.7's "a feed gets soft-deleted
 * between focus refreshes, the heatmap's today cell should reflect that." A request WITH a
 * `before` cursor ("Show older feeds") always resolves to an empty page here, since this helper
 * is for single-page focus-refresh scenarios, not pagination (use mockHistoryPages for that).
 */
async function mockHistoryFirstPageDynamic(page, stateProvider, { pets } = {}) {
  await mockPets(page, pets);
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
    const selectNorm = select.replace(/\s/g, '');
    const limit = u.searchParams.get('limit');
    if ((selectNorm === 'id,pet_id,created_at,logged_by' || selectNorm === 'id,created_at,logged_by') && limit === '100') {
      const hasBefore = u.searchParams.has('created_at');
      const feeds = hasBefore ? [] : stateProvider() || [];
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
async function mockSuccessfulWrites(page, { postDelayMs = 0, patchFailFirst = 0 } = {}) {
  let patchAttempts = 0;
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
        pet_id: body.pet_id || MOCK_PET_IDS[DEFAULT_PET_SLUG], // v1.1: logFeed's body now includes pet_id (contract.md §6.C)
        created_at: new Date().toISOString(),
        logged_by: body.logged_by ?? null,
        deleted_at: null,
      };
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([row]) });
    }
    if (req.method() === 'PATCH') {
      // `patchFailFirst` (AC-9.4: "undo fails, then a retry succeeds") aborts the first N PATCH
      // attempts before falling through to the same synthesized success response every later
      // attempt gets — a single route handler, since Playwright's most-recently-registered-first
      // route order means a second page.route() call "on top" would just shadow this one (see
      // specs/16-look-and-feel.spec.js AC-16.5l's own note on the same gotcha).
      if (patchAttempts < patchFailFirst) {
        patchAttempts += 1;
        return route.abort('failed');
      }
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

/**
 * AC-4.4's exact scenario, entirely mocked: the first POST for a given `id` is treated as
 * "reached the database but the response was lost" (the route just aborts — this mock has no
 * real database, so there's nothing to actually insert), and a RETRY POST carrying the SAME
 * `id` gets back the real duplicate-key conflict shape contract.md §6.C documents (409,
 * `code: '23505'`). api.js's own logFeed then follows up with a GET by that id (contract.md
 * §6.C's "fetch the row and resolve with it") — this mock answers that GET with a synthesized
 * row, so the whole "lost response -> 409 -> treated as success" path runs client-side with no
 * real network, and a test can assert exactly one row ever existed (by asserting exactly one
 * distinct `id` was ever POSTed, e.g. via a `page.on('request', ...)` count).
 */
async function mockLostResponseThenConflict(page) {
  const seenIds = new Set();
  await page.route(FEEDS_GLOB, async (route) => {
    const req = route.request();
    let u;
    try {
      u = new URL(req.url());
    } catch {
      return route.continue();
    }
    if (req.method() === 'POST') {
      let body = {};
      try {
        body = JSON.parse(req.postData() || '{}');
      } catch {
        /* ignore */
      }
      const id = body.id;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        return route.abort('failed'); // "reached the DB, but the client never saw the response"
      }
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint' }),
      });
    }
    if (req.method() === 'GET') {
      const idParam = u.searchParams.get('id') || '';
      const m = idParam.match(/^eq\.(.+)$/);
      if (m && seenIds.has(m[1])) {
        const row = {
          id: m[1],
          pet_id: MOCK_PET_IDS[DEFAULT_PET_SLUG],
          created_at: new Date().toISOString(),
          logged_by: null,
          deleted_at: null,
        };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) });
      }
    }
    return route.continue();
  });
}

/**
 * Like mockHomeDataAndWrites, but scoped PER PET (like mockHomeDataPerPet above) — for AC-17.4's
 * mocked counterpart: proving a POST for one pet never touches another pet's mocked state.
 * `dataBySlug` is `{ [petSlug]: { recent, todayCount } }`; a slug with no entry starts at
 * `{ recent: [], todayCount: 0 }`. A POST's `pet_id` (contract.md §6.C's body) determines which
 * pet's state it updates — a request for pet A's data can never see pet B's write, since each
 * slug's state is a separate object, only ever mutated by that same slug's own POST. One
 * combined route registration (not mockHomeDataPerPet + mockSuccessfulWrites as two calls) for
 * the same reason mockHomeDataAndWrites is: registration-order and caller-side-mutation races
 * (see that function's own doc comment for the confirmed repro).
 */
async function mockHomeDataPerPetAndWrites(page, dataBySlug = {}, { pets } = {}) {
  const petRows = await mockPets(page, pets);
  const slugById = new Map(petRows.map((p) => [p.id, p.slug]));
  const idBySlug = new Map(petRows.map((p) => [p.slug, p.id]));
  const states = {};
  for (const slug of Object.keys(dataBySlug)) {
    states[slug] = { recent: (dataBySlug[slug].recent || []).slice(), todayCount: dataBySlug[slug].todayCount || 0 };
  }
  const stateFor = (slug) => {
    if (!states[slug]) states[slug] = { recent: [], todayCount: 0 };
    return states[slug];
  };
  await page.route(FEEDS_GLOB, async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      let u;
      try {
        u = new URL(req.url());
      } catch {
        return route.continue();
      }
      const select = u.searchParams.get('select') || '';
      const selectNorm = select.replace(/\s/g, '');
      const limit = u.searchParams.get('limit');
      const petIdParam = u.searchParams.get('pet_id') || '';
      const idMatch = petIdParam.match(/^eq\.(.+)$/);
      const slug = idMatch ? slugById.get(idMatch[1]) : undefined;
      const state = stateFor(slug || '__unknown__');
      if ((selectNorm === 'id,pet_id,created_at,logged_by' || selectNorm === 'id,created_at,logged_by') && limit === '3') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.recent.slice(0, 3)) });
      }
      if (select === 'id' && u.searchParams.has('created_at') && !limit) {
        const arr = Array.from({ length: state.todayCount }, (_, i) => ({ id: `mock-count-${slug}-${i}` }));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(arr) });
      }
      return route.continue();
    }
    if (req.method() === 'POST') {
      let body = {};
      try {
        body = JSON.parse(req.postData() || '{}');
      } catch {
        /* ignore */
      }
      const slug = slugById.get(body.pet_id) || Object.keys(dataBySlug)[0];
      const state = stateFor(slug);
      const row = {
        id: body.id || `00000000-0000-4000-8000-${String(Date.now() % 1e12).padStart(12, '0')}`,
        pet_id: body.pet_id || idBySlug.get(slug),
        created_at: new Date().toISOString(),
        logged_by: body.logged_by ?? null,
        deleted_at: null,
      };
      state.recent = [row, ...state.recent];
      state.todayCount += 1;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([row]) });
    }
    return route.continue();
  });
  return states;
}

/**
 * Combines mockHomeData's fixed GET responses with mockSuccessfulWrites's synthesized
 * POST/PATCH responses in a SINGLE page.route() registration, for tests that need both (e.g.
 * every AC-9.x "mocked" scenario: log a feed via a mocked POST, then undo it via a mocked
 * PATCH, on top of a fixed initial home-data fixture).
 *
 * This is deliberately NOT the same as calling mockHomeData(page, ...) and
 * mockSuccessfulWrites(page, ...) as two separate page.route() calls (even one right after the
 * other, post-navigation): Playwright checks the MOST-RECENTLY-REGISTERED matching handler
 * first, and mockSuccessfulWrites's own GET branch falls through to `route.continue()` (straight
 * to the real, blocked network) rather than chaining to an older handler. Registering
 * mockSuccessfulWrites after gotoHome() resolves only avoids that race if the app's own initial
 * fetch has already fired and been served by then — which is not guaranteed (a page's own
 * 'load' event fires before its script's own async fetch necessarily starts), so that pattern
 * is flaky, not just inelegant: confirmed by direct repro, the two-call version intermittently
 * hangs the initial GET against the real host. One handler, no ordering to get right.
 *
 * Returns the live `state` object (`{ recent, todayCount }`) backing the GET responses, for a
 * test that wants to read it — but the mock updates it ITSELF (see below), so a caller does
 * NOT need to (and should not) mutate it manually.
 */
async function mockHomeDataAndWrites(page, { recent = [], todayCount = 0, pets, postDelayMs = 0, patchFailFirst = 0 } = {}) {
  const petRows = await mockPets(page, pets);
  // A live, mutable state object — NOT a fixed snapshot closed over at call time — because
  // this app's own "refetch right after a write resolves" behavior (confirmed by direct repro:
  // a fresh GET pair fires immediately after both a successful POST and a successful PATCH,
  // not just on the ~2s focus-refresh debounce) can otherwise re-fetch home data mid-test and
  // clobber an optimistically-rendered log/undo with stale data. State is updated INSIDE the
  // route handler itself, synchronously, at the moment each POST/PATCH is fulfilled — not by
  // the caller after the fact — because updating it from outside (e.g. after `await
  // page.waitForResponse(...)` resolves in the test) is itself a race: the app's own
  // immediately-following refetch can reach this route handler before the test script's
  // subsequent `await`-then-mutate line runs, since those are two independent JS execution
  // contexts with no ordering guarantee across the Playwright IPC boundary. Confirmed by direct
  // repro: that pattern intermittently left an undone/deleted row still showing in the mocked
  // GET response that raced ahead of the caller's own state update.
  const state = { recent: recent.slice(), todayCount };
  let patchAttempts = 0;
  await page.route(FEEDS_GLOB, async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      let u;
      try {
        u = new URL(req.url());
      } catch {
        return route.continue();
      }
      const select = u.searchParams.get('select') || '';
      const selectNorm = select.replace(/\s/g, '');
      const limit = u.searchParams.get('limit');
      if ((selectNorm === 'id,pet_id,created_at,logged_by' || selectNorm === 'id,created_at,logged_by') && limit === '3') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.recent.slice(0, 3)) });
      }
      if (select === 'id' && u.searchParams.has('created_at') && !limit) {
        const arr = Array.from({ length: state.todayCount }, (_, i) => ({ id: `mock-count-${i}` }));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(arr) });
      }
      return route.continue();
    }
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
        pet_id: body.pet_id || (petRows[0] && petRows[0].id) || MOCK_PET_IDS[DEFAULT_PET_SLUG],
        created_at: new Date().toISOString(),
        logged_by: body.logged_by ?? null,
        deleted_at: null,
      };
      // Update state BEFORE fulfilling, so even a refetch that lands a moment later sees it.
      state.recent = [row, ...state.recent];
      state.todayCount += 1;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([row]) });
    }
    if (req.method() === 'PATCH') {
      if (patchAttempts < patchFailFirst) {
        patchAttempts += 1;
        return route.abort('failed');
      }
      let body = {};
      try {
        body = JSON.parse(req.postData() || '{}');
      } catch {
        /* ignore */
      }
      const u = new URL(req.url());
      const idMatch = (u.searchParams.get('id') || '').match(/^eq\.(.+)$/);
      const id = idMatch ? idMatch[1] : null;
      if (id && state.recent.some((f) => f.id === id)) {
        state.recent = state.recent.filter((f) => f.id !== id);
        state.todayCount = Math.max(0, state.todayCount - 1);
      }
      const row = { id: id || 'unknown', deleted_at: body.deleted_at || new Date().toISOString() };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) });
    }
    return route.continue();
  });
  return state;
}

/** Counts requests to the feeds endpoint matching `method` (default POST), for assertions like
 *  AC-4.1's "5 rapid taps create exactly 1 row" that only need a request COUNT, never a real
 *  database round trip. Attach before the action under test; read `.count` after. */
function countFeedRequests(page, method = 'POST') {
  const state = { count: 0 };
  page.on('request', (req) => {
    if (req.method() === method && req.url().includes('/rest/v1/feeds')) state.count++;
  });
  return state;
}

module.exports = {
  FEEDS_GLOB,
  PETS_GLOB,
  MOCK_PET_IDS,
  mockPetRows,
  mockPets,
  fakeFeed,
  mockHomeData,
  mockHomeDataDynamic,
  mockHomeDataPerPet,
  mockHomeDataPerPetAndWrites,
  mockZeroFeeds,
  mockHistoryPages,
  mockHistoryFirstPage,
  mockHistoryFirstPageDynamic,
  mockSuccessfulWrites,
  mockHomeDataAndWrites,
  mockLostResponseThenConflict,
  countFeedRequests,
};
