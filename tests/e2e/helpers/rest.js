// tests/e2e/helpers/rest.js
// Thin wrapper around Supabase PostgREST, used directly (not through the app) for:
//   - the "must fail" direct-REST checks (contract.md §6.F / AC-5.2, AC-11.1, AC-11.2)
//   - seeding and cleaning up QA-test rows (tasks.md §2 "Data hygiene")
//   - assertions against the real database state after UI actions
//
// Uses Node's built-in fetch (Node 22+). Never sends an Authorization header —
// contract.md §4 says the publishable key belongs only in `apikey`.
//
// v1.1 (contract.md §1/§2/§6.G): `feeds.pet_id` is now NOT NULL, and there's a new `pets`
// table. Every function below that inserts a feed now resolves/accepts a `petId`, defaulting
// to Pumo's (the pre-v1.1 call shape `insertFeed({ logged_by })` still works unchanged for
// every existing v1 spec file — it just now also does one extra GET to resolve Pumo's id,
// cached after the first call). None of this can succeed until the migration in
// backend/schema.sql has actually been applied against the live project — until then, every
// call in this file that touches `pets` or inserts into `feeds` will fail (400 "pet_id
// violates not-null constraint" for feeds inserts without a migration, or 404/PGRST205 for
// `pets` if the table doesn't exist yet). That's expected during this scaffolding pass.

'use strict';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, QA_LOGGED_BY, DEFAULT_PET_SLUG } = require('../config');

const FEEDS_URL = `${SUPABASE_URL}/rest/v1/feeds`;
const PETS_URL = `${SUPABASE_URL}/rest/v1/pets`;

function baseHeaders(extra) {
  return Object.assign(
    {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Accept: 'application/json',
    },
    extra
  );
}

/** Low-level request against an arbitrary base URL. Returns { status, ok, headers, body,
 *  bodyText }. Never throws on non-2xx. */
async function requestTo(baseUrl, method, path, { body, prefer } = {}) {
  const headers = baseHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers['Prefer'] = prefer;

  const res = await fetch(`${baseUrl}${path}`, {
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

/** Low-level request against the feeds endpoint (unchanged signature from v1). */
async function request(method, path, opts = {}) {
  return requestTo(FEEDS_URL, method, path, opts);
}

/** Low-level request against the pets endpoint (v1.1). */
async function requestPets(method, path, opts = {}) {
  return requestTo(PETS_URL, method, path, opts);
}

// ---- Pets (v1.1, contract.md §6.G) ----------------------------------------------------

// In-memory cache: getPets() is documented as "called once per page load, cached in memory
// for the session (the list never changes without a deploy)" (contract.md §6.G) — QA mirrors
// that so a whole spec run only hits `pets` once, not once per test.
let petsCache = null;

/** GET the pet list (contract.md §6.G). Throws if the call fails (e.g. pre-migration). */
async function getPets({ fresh = false } = {}) {
  if (petsCache && !fresh) return petsCache;
  const r = await requestPets(
    'GET',
    '?select=id,slug,name,species,sort_order,photo_url&order=sort_order.asc'
  );
  if (r.status !== 200) {
    throw new Error(
      `getPets failed: ${r.status} ${r.bodyText} — expected before the pets/pet_id migration ` +
        `(backend/schema.sql) has been applied; not an error worth filing until it has.`
    );
  }
  petsCache = r.body;
  return petsCache;
}

/** Resolves a pet's id by slug, falling back to DEFAULT_PET_SLUG for an unrecognized one —
 *  mirrors contract.md §7.10's petSlugFromLocation fallback rule, but for REST-side seeding. */
async function getPetIdBySlug(slug = DEFAULT_PET_SLUG) {
  const pets = await getPets();
  const found = pets.find((p) => p.slug === slug) || pets.find((p) => p.slug === DEFAULT_PET_SLUG);
  if (!found) {
    throw new Error(
      `getPetIdBySlug: no pet with slug "${slug}" and no fallback "${DEFAULT_PET_SLUG}" either — ` +
        `pets table is empty or unseeded.`
    );
  }
  return found.id;
}

/** Resets the in-memory pets cache — call after a test that seeds/mocks a different pet list,
 *  so a later real getPets() doesn't reuse a stale/fixture value. */
function resetPetsCache() {
  petsCache = null;
}

/** POST to /rest/v1/pets — must always fail (contract.md §6, "Calls that must fail"). */
async function attemptPostToPets() {
  return requestPets('POST', '', {
    body: { slug: 'test', name: 'Test', species: 'cat', sort_order: 9 },
    prefer: 'return=representation',
  });
}

// ---- Normal (allowed) operations, used for seeding/cleanup and assertions ----

/** GET last N live feeds for one pet, newest first. Mirrors contract.md §6.A.
 *  `petSlug` defaults to Pumo (DEFAULT_PET_SLUG); pass a slug or a raw petId via `petId` to
 *  scope to a different pet. Resolves the id via getPets() when only a slug is given. */
async function getLastFeeds(n = 3, { petSlug = DEFAULT_PET_SLUG, petId } = {}) {
  const id = petId || (await getPetIdBySlug(petSlug));
  const r = await request(
    'GET',
    `?select=id,pet_id,created_at,logged_by&pet_id=eq.${encodeURIComponent(id)}&deleted_at=is.null&order=created_at.desc&limit=${n}`
  );
  if (r.status !== 200) throw new Error(`getLastFeeds failed: ${r.status} ${r.bodyText}`);
  return r.body;
}

/** GET a single row by id, including soft-deleted (anon may read deleted rows). A feed's id
 *  is globally unique (contract.md §6.D note), so this needs no pet_id filter. */
async function getById(id) {
  const r = await request(
    'GET',
    `?select=id,pet_id,created_at,logged_by,deleted_at&id=eq.${encodeURIComponent(id)}`
  );
  if (r.status !== 200) throw new Error(`getById failed: ${r.status} ${r.bodyText}`);
  return r.body[0] || null;
}

/** GET rows matching an arbitrary raw querystring (already encoded), for ad-hoc assertions.
 *  Callers doing anything pet-scoped must include their own `pet_id=eq....` in `qs`. */
async function getRaw(qs) {
  const r = await request('GET', qs);
  if (r.status !== 200) throw new Error(`getRaw failed: ${r.status} ${r.bodyText}`);
  return r.body;
}

/** Insert a feed the allowed way (id + pet_id + logged_by only). Returns the inserted row.
 *  `pet_id` is required by the live v1.1 schema (contract.md §1, `not null`); defaults to
 *  Pumo's id (resolved via getPets(), cached) when neither `petId` nor `petSlug` is given, so
 *  every pre-v1.1 call site (`insertFeed({ logged_by })`) keeps working unchanged. */
async function insertFeed({ id, petId, petSlug = DEFAULT_PET_SLUG, logged_by = QA_LOGGED_BY } = {}) {
  const resolvedPetId = petId || (await getPetIdBySlug(petSlug));
  const row = { pet_id: resolvedPetId, logged_by };
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

/** Count/list all still-live QA-test rows, for the "no live QA-test rows remain" check.
 *  No pet_id filter, so this already covers all 3 pets in one call — tasks.md §2's "before
 *  each scenario, soft-delete every live QA-test row (across all 3 pets)" and the Done-means
 *  "no live QA-test rows remain, for any of the 3 pets" both fall out of this for free, since
 *  a feed's `id` (and therefore `logged_by`) is unique regardless of which pet it belongs to. */
async function listLiveQaTestRows() {
  return getRaw(
    `?select=id,pet_id,created_at&logged_by=eq.${encodeURIComponent(QA_LOGGED_BY)}&deleted_at=is.null`
  );
}

/** Seed N feeds with logged_by=QA-test via direct REST insert (used for AC-12.3's 101 rows).
 *  All for one pet by default (Pumo) — pass petSlug/petId to target a different one. */
async function seedFeeds(n, loggedBy = QA_LOGGED_BY, { petSlug = DEFAULT_PET_SLUG, petId } = {}) {
  const resolvedPetId = petId || (await getPetIdBySlug(petSlug));
  const rows = [];
  // Sequential to keep created_at strictly increasing/ordered and avoid hammering the API.
  for (let i = 0; i < n; i++) {
    rows.push(await insertFeed({ logged_by: loggedBy, petId: resolvedPetId }));
  }
  return rows;
}

// ---- "Must fail" direct-REST checks (contract.md §6.F) ----

/** DELETE — must be rejected. AC-11.2. */
async function attemptHardDelete(id) {
  return request('DELETE', `?id=eq.${encodeURIComponent(id)}`);
}

/** POST with a client-supplied created_at — must be rejected. Part of AC-5.2. Per contract.md
 *  §6's "Calls that must fail" table, this now includes a real pet_id (the not-null
 *  constraint would otherwise reject the row for an unrelated reason and mask whether the
 *  created_at column-grant check is what actually fired). */
async function attemptPostWithCreatedAt({ petSlug = DEFAULT_PET_SLUG, petId } = {}) {
  const resolvedPetId = petId || (await getPetIdBySlug(petSlug));
  return request('POST', '', {
    body: { pet_id: resolvedPetId, logged_by: QA_LOGGED_BY, created_at: '2020-01-01T00:00:00Z' },
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
  PETS_URL,
  request,
  requestTo,
  requestPets,
  getPets,
  getPetIdBySlug,
  resetPetsCache,
  attemptPostToPets,
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
