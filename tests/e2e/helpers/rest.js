// tests/e2e/helpers/rest.js
// Thin wrapper around Supabase PostgREST, used directly (not through the app) for:
//   - the "must fail" direct-REST checks (contract.md §6.F / AC-5.2, AC-11.1, AC-11.2)
//   - seeding and cleaning up QA-test rows (tasks.md §2 "Data hygiene")
//   - assertions against the real database state after UI actions
//
// Uses Node's built-in fetch (Node 22+). Never sends an Authorization header —
// contract.md §4 says the publishable key belongs only in `apikey`.

'use strict';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, QA_LOGGED_BY } = require('../config');

const FEEDS_URL = `${SUPABASE_URL}/rest/v1/feeds`;

function baseHeaders(extra) {
  return Object.assign(
    {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Accept: 'application/json',
    },
    extra
  );
}

/** Low-level request. Returns { status, ok, headers, body, bodyText }. Never throws on non-2xx. */
async function request(method, path, { body, prefer } = {}) {
  const headers = baseHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers['Prefer'] = prefer;

  const res = await fetch(`${FEEDS_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  const bodyText = await res.text();
  let parsed;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, ok: res.ok, headers: res.headers, body: parsed, bodyText };
}

// ---- Normal (allowed) operations, used for seeding/cleanup and assertions ----

/** GET last N live feeds, newest first. Mirrors contract.md §6.A. */
async function getLastFeeds(n = 3) {
  const r = await request(
    'GET',
    `?select=id,created_at,logged_by&deleted_at=is.null&order=created_at.desc&limit=${n}`
  );
  if (r.status !== 200) throw new Error(`getLastFeeds failed: ${r.status} ${r.bodyText}`);
  return r.body;
}

/** GET a single row by id, including soft-deleted (anon may read deleted rows). */
async function getById(id) {
  const r = await request(
    'GET',
    `?select=id,created_at,logged_by,deleted_at&id=eq.${encodeURIComponent(id)}`
  );
  if (r.status !== 200) throw new Error(`getById failed: ${r.status} ${r.bodyText}`);
  return r.body[0] || null;
}

/** GET rows matching an arbitrary raw querystring (already encoded), for ad-hoc assertions. */
async function getRaw(qs) {
  const r = await request('GET', qs);
  if (r.status !== 200) throw new Error(`getRaw failed: ${r.status} ${r.bodyText}`);
  return r.body;
}

/** Insert a feed the allowed way (id + logged_by only). Returns the inserted row. */
async function insertFeed({ id, logged_by = QA_LOGGED_BY } = {}) {
  const row = { logged_by };
  if (id) row.id = id;
  const r = await request('POST', '', { body: row, prefer: 'return=representation' });
  if (r.status !== 201) throw new Error(`insertFeed failed: ${r.status} ${r.bodyText}`);
  return r.body[0];
}

/** Soft-delete one row by id (the only kind of delete the schema allows). */
async function softDeleteById(id) {
  const r = await request('PATCH', `?id=eq.${encodeURIComponent(id)}&deleted_at=is.null`, {
    body: { deleted_at: new Date().toISOString() },
    prefer: 'return=representation',
  });
  if (r.status !== 200) throw new Error(`softDeleteById failed: ${r.status} ${r.bodyText}`);
  return r.body;
}

/** Soft-delete every live row with the given logged_by (default QA-test). Used for cleanup
 *  and for the "before each scenario" reset in tasks.md §2 Data hygiene. */
async function softDeleteAllByLoggedBy(loggedBy = QA_LOGGED_BY) {
  const r = await request(
    'PATCH',
    `?logged_by=eq.${encodeURIComponent(loggedBy)}&deleted_at=is.null`,
    { body: { deleted_at: new Date().toISOString() }, prefer: 'return=representation' }
  );
  if (r.status !== 200) throw new Error(`softDeleteAllByLoggedBy failed: ${r.status} ${r.bodyText}`);
  return r.body;
}

/** Count/list all still-live QA-test rows, for the "no live QA-test rows remain" check. */
async function listLiveQaTestRows() {
  return getRaw(
    `?select=id,created_at&logged_by=eq.${encodeURIComponent(QA_LOGGED_BY)}&deleted_at=is.null`
  );
}

/** Seed N feeds with logged_by=QA-test via direct REST insert (used for AC-12.3's 101 rows). */
async function seedFeeds(n, loggedBy = QA_LOGGED_BY) {
  const rows = [];
  // Sequential to keep created_at strictly increasing/ordered and avoid hammering the API.
  for (let i = 0; i < n; i++) {
    rows.push(await insertFeed({ logged_by: loggedBy }));
  }
  return rows;
}

// ---- "Must fail" direct-REST checks (contract.md §6.F) ----

/** DELETE — must be rejected. AC-11.2. */
async function attemptHardDelete(id) {
  return request('DELETE', `?id=eq.${encodeURIComponent(id)}`);
}

/** POST with a client-supplied created_at — must be rejected. Part of AC-5.2. */
async function attemptPostWithCreatedAt() {
  return request('POST', '', {
    body: { logged_by: QA_LOGGED_BY, created_at: '2020-01-01T00:00:00Z' },
    prefer: 'return=representation',
  });
}

/** PATCH trying to set created_at — must be rejected. Part of AC-5.2. */
async function attemptPatchCreatedAt(id) {
  return request('PATCH', `?id=eq.${encodeURIComponent(id)}`, {
    body: { created_at: '2020-01-01T00:00:00Z' },
    prefer: 'return=representation',
  });
}

module.exports = {
  FEEDS_URL,
  request,
  getLastFeeds,
  getById,
  getRaw,
  insertFeed,
  softDeleteById,
  softDeleteAllByLoggedBy,
  listLiveQaTestRows,
  seedFeeds,
  attemptHardDelete,
  attemptPostWithCreatedAt,
  attemptPatchCreatedAt,
};
