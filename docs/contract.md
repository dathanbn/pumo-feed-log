# Pumo Feed Log: contract

Everything in the app depends on this one interface: **the `public.pets` and `public.feeds` tables exposed through Supabase's REST API**, plus the shared constants and rules below. The frontend code (`api.js`, `logic.js`, `constants.js`), the unit tests and QA all build against this file. If something here seems wrong during the build, follow it anyway and note the concern. Don't silently deviate.

**v1.1 change note:** v1 shipped with one pet and a midnight day boundary. v1.1 adds `public.pets`, a `pet_id` column on `feeds`, and moves the day boundary to 3 AM local time. Every table, constant and function below is the **current**, post-v1.1 contract — there is no separate "v1 contract" to reconcile against.

**v1.2 change note:** Zuumi and Banh Mi now have real photos (no schema change — `photo_url` already supported this). Two new things: the client can now correct a feed's logged time (widens the `created_at` update grant, adds a DB-level "not in the future" check — §6.H, §7.11), and the CSV button moves into the heatmap card's header, restyled as a subtle text button (design.md §4.2 — no contract change, UI only).

## 1. The tables

### `public.pets`
| Column | Type | Null | Default | Who writes it | Meaning |
|---|---|---|---|---|---|
| `id` | `uuid` | no (PK) | `gen_random_uuid()` | Set once, at migration time | Pet identity |
| `slug` | `text` | no (unique) | — | Set once, at migration time | URL-safe identifier: `pumo`, `zuumi`, `banh-mi`. Lowercase, hyphens only. |
| `name` | `text` | no | — | Set once, at migration time | Display name: "Pumo", "Zuumi", "Banh Mi" |
| `species` | `text` | no | — | Set once, at migration time | `cat` or `dog`, used only to pick a placeholder avatar shape |
| `sort_order` | `int2` | no | — | Set once, at migration time | Picker order: Pumo 0, Zuumi 1, Banh Mi 2 |
| `photo_url` | `text` | yes | `null` | Set once, at migration time | Relative path like `assets/pumo.jpg`, or `null` for the placeholder avatar |

The client never inserts, updates or deletes pets. The 3 rows are seeded once by the migration SQL below; adding a 4th pet later is a manual SQL insert, exactly like adding the first photo was in v1.

### `public.feeds` (unchanged columns, plus `pet_id`)
| Column | Type | Null | Default | Who writes it | Meaning |
|---|---|---|---|---|---|
| `id` | `uuid` | no (PK) | `gen_random_uuid()` | The phone generates it (see §6.C). The default is a safety net. | Feed identity, and what makes retries safe |
| `pet_id` | `uuid` | no (FK → `pets.id`) | — | The phone, on insert only | Which pet this feed is for |
| `created_at` | `timestamptz` | no | `now()` | The server, at insert. **Anon may `UPDATE` it after insert (v1.2)** to correct a mistaken time — see §6.H — but never `INSERT` it. A DB check (`feeds_created_at_not_future`) rejects any value more than 5 minutes in the future either way. | When the feed happened |
| `logged_by` | `text` | yes | `null` | The phone, on insert only | Display name from that phone's localStorage, or `null` ("Someone") |
| `deleted_at` | `timestamptz` | yes | `null` | The phone, on undo or delete | `null` means a live feed. Non-null means soft-deleted. The value is informational. |

`pet_id` is `not null` on the live schema. The migration gets there in two steps (add nullable → backfill → add the not-null constraint) so it's safe to run against the populated v1 table without breaking existing rows.

## 2. Exact setup SQL (also `backend/schema.sql`, and identical to architecture.md §7 step 2)

This is the **complete, current** schema — safe to run on a fresh database, and safe to re-run against the live v1 database to migrate it (the `pets`/`feeds` creates are `if not exists`, the `pet_id` add is guarded, and the backfill only touches rows that still have `pet_id is null`).

```sql
-- Pumo Feed Log: complete database setup (Supabase / Postgres). Safe to re-run.

-- ---- pets -----------------------------------------------------------------
create table if not exists public.pets (
  id          uuid        primary key default gen_random_uuid(),
  slug        text        not null unique,
  name        text        not null,
  species     text        not null check (species in ('cat', 'dog')),
  sort_order  int2        not null,
  photo_url   text        null
);

comment on table public.pets is
  'Pumo Feed Log. Fixed small list of household pets. Client is read-only.';

insert into public.pets (slug, name, species, sort_order, photo_url)
values
  ('pumo', 'Pumo', 'cat', 0, 'assets/pumo.jpg'),
  ('zuumi', 'Zuumi', 'cat', 1, 'assets/zuumi.jpg'),
  ('banh-mi', 'Banh Mi', 'dog', 2, 'assets/banh-mi.jpg')
on conflict (slug) do nothing;

-- v1.2: Zuumi and Banh Mi got real photos after the initial seed above (which is why the insert
-- has "do nothing" on conflict and doesn't retroactively fix already-seeded rows). Re-running this
-- file on a fresh project is fine — the insert already has the right URLs. On an existing project
-- that seeded them as null, this one-time backfill catches it up:
update public.pets set photo_url = 'assets/zuumi.jpg' where slug = 'zuumi' and photo_url is null;
update public.pets set photo_url = 'assets/banh-mi.jpg' where slug = 'banh-mi' and photo_url is null;

alter table public.pets enable row level security;
revoke all on table public.pets from anon, authenticated;
grant usage on schema public to anon;
grant select on table public.pets to anon;  -- anyone with the link can see the pet list

drop policy if exists pets_anon_select on public.pets;
create policy pets_anon_select on public.pets for select to anon using (true);
-- No insert/update/delete grant or policy: the pet list is fixed, edited only from the dashboard.

-- ---- feeds ------------------------------------------------------------------
create table if not exists public.feeds (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  logged_by   text        null,
  deleted_at  timestamptz null
);

comment on table public.feeds is
  'Pumo Feed Log. One row per feed, one pet per row. Soft delete only: deleted_at not null means deleted.';

-- v1.2: created_at can now be corrected by the client (a fixed-time edit, not just server-set at
-- insert). This DB-level backstop keeps it from ever landing in the future even via a direct API
-- call, bypassing the app's own "no future time" validation. 5 min covers normal clock skew.
alter table public.feeds drop constraint if exists feeds_created_at_not_future;
alter table public.feeds
  add constraint feeds_created_at_not_future
  check (created_at <= now() + interval '5 minutes');

-- Add pet_id if this is a migration from v1 (nullable at first, so the ALTER never fails on existing rows).
alter table public.feeds add column if not exists pet_id uuid references public.pets(id);

-- Backfill any pre-v1.1 rows (pet_id still null) to Pumo.
update public.feeds
set pet_id = (select id from public.pets where slug = 'pumo')
where pet_id is null;

-- Now that every row has a pet, make it required going forward.
alter table public.feeds alter column pet_id set not null;

-- Row Level Security on.
alter table public.feeds enable row level security;

-- Table privileges. Newer Supabase projects no longer grant these automatically, so set them explicitly.
revoke all on table public.feeds from anon, authenticated;
grant usage on schema public to anon;
grant select on table public.feeds to anon;                          -- anyone with the link can read
grant insert (id, pet_id, logged_by) on table public.feeds to anon;  -- created_at is always the server's now() at insert time
grant update (deleted_at, created_at) on table public.feeds to anon; -- soft delete, and (v1.2) correcting a feed's logged time
-- Deliberately no DELETE grant: rows can never be hard-deleted through the API.
-- Deliberately no update grant on pet_id or logged_by: which pet and who fed them are never editable.

-- Permissive RLS policies for the anon role.
drop policy if exists feeds_anon_select on public.feeds;
create policy feeds_anon_select on public.feeds for select to anon using (true);

drop policy if exists feeds_anon_insert on public.feeds;
create policy feeds_anon_insert on public.feeds for insert to anon with check (true);

drop policy if exists feeds_anon_update on public.feeds;
create policy feeds_anon_update on public.feeds for update to anon using (true) with check (true);
-- Deliberately no DELETE policy.

create index if not exists feeds_pet_id_created_at_idx on public.feeds (pet_id, created_at desc);
```

## 3. What the anon role (publishable key) can and cannot do

| Action | Allowed | Enforced by |
|---|---|---|
| Read any row in `feeds`, including soft-deleted rows | Yes | `grant select` plus the select policy. The app filters out deleted rows itself. |
| Read `pets` | Yes | `grant select` plus the select policy |
| Insert a feed with `id`, `pet_id` and/or `logged_by` | Yes | Column grant plus the insert policy |
| Insert a feed that sets `created_at` or `deleted_at` | **No** (401/403, `42501`) | Column grant |
| Update `deleted_at` (set or clear) | Yes | Column grant plus the update policy |
| Update `created_at` to a valid time, on a still-live row (v1.2) | Yes | Column grant plus the update policy |
| Update `created_at` to more than 5 minutes in the future | **No** (400/409, `23514`) | `feeds_created_at_not_future` check constraint |
| Update `id`, `pet_id` or `logged_by` on `feeds` | **No** (401/403, `42501`) | Column grant |
| Insert, update or delete on `pets` | **No** (401/403, `42501`) | No grant and no policy — the pet list is fixed |
| `DELETE` on `feeds` | **No** (401/403, `42501`) | No grant and no policy |

## 4. Connection

- **Base URL:** `{SUPABASE_URL}/rest/v1/feeds`, where `SUPABASE_URL` comes from `frontend/js/config.js`.
- **Headers on every request:**
  - `apikey: {SUPABASE_PUBLISHABLE_KEY}`
  - `Accept: application/json`
  - Add `Content-Type: application/json` on POST and PATCH.
  - **Don't** send an `Authorization: Bearer` header. Publishable keys belong only in `apikey`.
- **Fetch options:** `cache: 'no-store'`, plus an `AbortController` timeout of `REQUEST_TIMEOUT_MS`.
- **URL encoding:** encode every filter value with `encodeURIComponent`. Timestamps returned by the API contain `+00:00`, and an unencoded `+` gets read as a space.

`frontend/js/config.js`:
```js
export const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_XXXXXXXXXXXXXXXXXXXXXXXX';
```
Per-pet photo URLs now live on the `pets` row (`photo_url`), not in `config.js` — see §6.G. `PUMO_PHOTO_URL` is retired; keep `frontend/assets/pumo.jpg` as the file, referenced by `pets.photo_url = 'assets/pumo.jpg'`.

## 5. Example rows (as the API returns them)

```json
{
  "id": "b6a1f2c0-1111-4a2b-8c3d-9e0f1a2b3c4d",
  "slug": "pumo",
  "name": "Pumo",
  "species": "cat",
  "sort_order": 0,
  "photo_url": "assets/pumo.jpg"
}
```
```json
{
  "id": "5f0c3a7e-2b1d-4c1e-9a4f-7d2e8b6c1a90",
  "pet_id": "b6a1f2c0-1111-4a2b-8c3d-9e0f1a2b3c4d",
  "created_at": "2026-09-16T14:42:07.318912+00:00",
  "logged_by": "Sam",
  "deleted_at": null
}
```
The JS types used throughout the app:
`Pet = { id: string, slug: string, name: string, species: 'cat' | 'dog', sort_order: number, photo_url: string | null }`
`Feed = { id: string, pet_id: string, created_at: string, logged_by: string | null, deleted_at?: string | null }`

## 6. Operations

`api.js` exports exactly these eight functions. Every one of them either resolves with the shape shown or throws an `ApiError` (§8). Every operation below except G is **scoped to one `petId`** — there is no "all pets" query anywhere in the live UI (CSV export in §6.F.2 is the one deliberate exception, and it's client-side pagination over the same per-pet endpoint, not a new query shape).

### G. Get the pet list: `getPets()`
```
GET {SUPABASE_URL}/rest/v1/pets?select=id,slug,name,species,sort_order,photo_url&order=sort_order.asc
```
Response `200`: an array of all `Pet` rows (always 3+, never empty once migrated), ascending `sort_order`. Called once per page load, cached in memory for the session (the list never changes without a deploy). Resolving the current pet from the URL (§10) means finding the `Pet` whose `slug` matches; an unknown or missing slug falls back to the pet with `sort_order = 0` (Pumo).

### A. Get last 3 feeds + B. get today's count (together: `getHomeData(now: Date, petId: string)`)
Both requests run in parallel, and both must succeed.

**A. Last 3 feeds for this pet**
```
GET {SUPABASE_URL}/rest/v1/feeds?select=id,pet_id,created_at,logged_by&pet_id=eq.{petId}&deleted_at=is.null&order=created_at.desc&limit=3
```
Response `200`:
```json
[
  { "id": "5f0c3a7e-2b1d-4c1e-9a4f-7d2e8b6c1a90", "pet_id": "b6a1f2c0-1111-4a2b-8c3d-9e0f1a2b3c4d", "created_at": "2026-09-16T14:42:07.318912+00:00", "logged_by": "Sam" },
  { "id": "a1d2e3f4-0000-4b5c-8d9e-112233445566", "pet_id": "b6a1f2c0-1111-4a2b-8c3d-9e0f1a2b3c4d", "created_at": "2026-09-16T10:10:51.004211+00:00", "logged_by": null },
  { "id": "0b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e", "pet_id": "b6a1f2c0-1111-4a2b-8c3d-9e0f1a2b3c4d", "created_at": "2026-09-16T04:55:13.771020+00:00", "logged_by": "Alex" }
]
```
It returns 0–3 items, newest first. `[]` means there are no feeds yet for this pet.

**B. Today's count for this pet**
`since` = `startOfFeedDay(now).toISOString()` (§7.6 — the 3 AM boundary, not midnight).
```
GET {SUPABASE_URL}/rest/v1/feeds?select=id&pet_id=eq.{petId}&deleted_at=is.null&created_at=gte.2026-09-16T10%3A00%3A00.000Z
```
Response `200`: `[{ "id": "…" }, { "id": "…" }, { "id": "…" }]`. `todayCount` is the array's length.

**`getHomeData` resolves to:**
```json
{ "recent": [ /* ≤3 Feed, newest first */ ], "todayCount": 3, "loadedAt": 1789569727318 }
```
`loadedAt` is `Date.now()` when both responses have arrived.

### C. Log a new feed: `logFeed({ id, petId, logged_by })`
The phone generates `id` once per log attempt with `newFeedId()`. That's `crypto.randomUUID()`, or an RFC 4122 v4 UUID built from `crypto.getRandomValues` when `randomUUID` is missing. A retry of the same attempt **reuses the same id**.
```
POST {SUPABASE_URL}/rest/v1/feeds
apikey: {key}
Content-Type: application/json
Prefer: return=representation

{"id":"5f0c3a7e-2b1d-4c1e-9a4f-7d2e8b6c1a90","pet_id":"b6a1f2c0-1111-4a2b-8c3d-9e0f1a2b3c4d","logged_by":"Sam"}
```
- `logged_by` is `null` when the phone has no name. **Never send `created_at` or `deleted_at`.**
- **`201`:** `[ { "id": "5f0c…", "pet_id": "b6a1…", "created_at": "2026-09-16T14:42:07.318912+00:00", "logged_by": "Sam", "deleted_at": null } ]`. Resolve with the first element.
- **`409` with body `{"code":"23505", …}`:** this id already exists, meaning an earlier try reached the database but its response was lost. Treat it as **success**. Fetch the row and resolve with it:
  ```
  GET {SUPABASE_URL}/rest/v1/feeds?select=id,pet_id,created_at,logged_by,deleted_at&id=eq.5f0c3a7e-2b1d-4c1e-9a4f-7d2e8b6c1a90
  ```
- Anything else: throw an `ApiError`.

### D. Soft-delete a feed, used for both Undo and Delete: `softDeleteFeed(id)`
```
PATCH {SUPABASE_URL}/rest/v1/feeds?id=eq.5f0c3a7e-2b1d-4c1e-9a4f-7d2e8b6c1a90&deleted_at=is.null
apikey: {key}
Content-Type: application/json
Prefer: return=representation

{"deleted_at":"2026-09-16T14:42:15.004Z"}
```
- **`200` with `[ {row with deleted_at set} ]`:** deleted now. Resolve `{ alreadyDeleted: false }`.
- **`200` with `[]`:** already deleted, perhaps from another phone, or the id doesn't exist. Resolve `{ alreadyDeleted: true }`. The UI treats this as success and refreshes.
- `deleted_at` is `new Date().toISOString()` from the phone.
- The app **never** uses the HTTP `DELETE` method.
- Unchanged by v1.1: it takes only `id`, never `pet_id` — a feed's id is already globally unique.

### H. Correct a feed's time: `updateFeedTime(id, newIso)` (v1.2)
Same idempotent, id-only shape as D — a feed's id is already globally unique, so this never needs `pet_id` either.
```
PATCH {SUPABASE_URL}/rest/v1/feeds?id=eq.5f0c3a7e-2b1d-4c1e-9a4f-7d2e8b6c1a90&deleted_at=is.null
apikey: {key}
Content-Type: application/json
Prefer: return=representation

{"created_at":"2026-09-16T13:05:00.000Z"}
```
- **`200` with `[ {row with created_at updated} ]`:** resolve with the updated `Feed`.
- **`200` with `[]`:** the feed was deleted (by any phone) before this saved, or the id doesn't exist. Resolve `{ alreadyDeleted: true }` — same shape and meaning as D's `alreadyDeleted`. The UI shows "This feed was deleted." (design.md §3.6b) instead of applying the edit, and refreshes.
- **`400`/`409` with `code: "23514"`:** the DB rejected a `created_at` more than 5 minutes in the future (§1, §3). This should never happen in normal use, because §7.11's `computeEditedTimestamp` already refuses to build a future timestamp client-side — treat it as an `ApiError` like any other unexpected failure (§8), not a special UI case.
- `newIso` always comes from `computeEditedTimestamp` (§7.11), never a raw, unvalidated input value.
- The app never lets someone edit `pet_id` or `logged_by` — only the timestamp. There is no server-side way to move a feed to a different pet or attribute it to a different feeder; that's still delete-and-relog.

### E. History page: `getHistoryPage({ petId, before })`
First page:
```
GET {SUPABASE_URL}/rest/v1/feeds?select=id,pet_id,created_at,logged_by&pet_id=eq.{petId}&deleted_at=is.null&order=created_at.desc&limit=100
```
Next page. `before` is the `created_at` of the oldest feed loaded so far, encoded:
```
GET {SUPABASE_URL}/rest/v1/feeds?select=id,pet_id,created_at,logged_by&pet_id=eq.{petId}&deleted_at=is.null&order=created_at.desc&limit=100&created_at=lt.2026-06-02T08%3A14%3A09.120044%2B00%3A00
```
Resolves to `{ "feeds": [ /* Feed, newest first */ ], "hasMore": true }`, where `hasMore` is `feeds.length === HISTORY_PAGE_SIZE`.

### F. History-related additions

**F.1 Heatmap data.** The heatmap (design.md §4.1) reads from the *same already-loaded* history pages — `getHistoryPage` is already ordered newest-first and the heatmap only needs `HEATMAP_WEEKS` (§7.1) weeks back, which is well within one 100-row page in normal household use. No new endpoint: `buildHeatmap` (§7.9) is a pure function over feeds already in memory. If `hasMore` is true and the oldest loaded feed is still inside the heatmap's date range, history.js fetches one additional page before building the heatmap, exactly like any other "need more data" case — it does not special-case the heatmap's network access.

**F.2 CSV export: `getAllFeedsForExport(petId)`.** Pages through `getHistoryPage` (§6.E) with the same `petId`, following `hasMore` until it's false, and concatenates every page into one newest-first array. This is the one place the app deliberately fetches beyond `HISTORY_PAGE_SIZE` — see design.md §4.2 for why (a full backup export, not a paginated view). Resolves to `Feed[]`. On any page failing, throw the same `ApiError` that page's fetch threw; partial results are discarded (an incomplete CSV would be worse than a clear retry).

### Calls that must fail (QA and preflight only; the app never makes them)
| Call | Expected |
|---|---|
| `DELETE {SUPABASE_URL}/rest/v1/feeds?id=eq.{id}` | 401 or 403, `code: "42501"`, and the row still exists |
| `POST /rest/v1/feeds` body `{"pet_id":"{a real pet id}","logged_by":"QA-test","created_at":"2020-01-01T00:00:00Z"}` | 401 or 403, `code: "42501"` |
| `PATCH /rest/v1/feeds?id=eq.{id}` body `{"pet_id":"{a different real pet id}"}` | 401 or 403, `code: "42501"` — which pet a feed belongs to is never editable |
| `PATCH /rest/v1/feeds?id=eq.{id}` body `{"logged_by":"QA-test"}` | 401 or 403, `code: "42501"` — who fed them is never editable after the fact |
| `PATCH /rest/v1/feeds?id=eq.{id}` body `{"created_at":"{now + 1 day, ISO}"}` | 400 or 409, `code: "23514"` (the `feeds_created_at_not_future` check) — **this one now differs from v1.1**: a *past* `created_at` on this same call succeeds (§6.H); only a future one is rejected |
| `POST /rest/v1/pets` body `{"slug":"test","name":"Test","species":"cat","sort_order":9}` | 401 or 403, `code: "42501"` — the pet list is read-only from the client |

## 7. Shared constants and rules

### 7.1 `frontend/js/constants.js` (exact)
```js
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
```

### 7.2 Guards: `guardState(now, lastFeed, todayCount)` and `armedLabel`
```
elapsed = lastFeed ? max(0, now - Date.parse(lastFeed.created_at)) : null
recent  = lastFeed != null && elapsed < RECENT_FEED_GUARD_MS      // strictly less: exactly 2h00m00s → no guard
daily   = todayCount >= DAILY_FEED_TARGET
guarded = recent || daily
```
Armed label:
- recent only: `Fed {formatRelative(elapsed)} — log another?`, e.g. "Fed 1h 40m ago — log another?" or "Fed just now — log another?"
- daily only: `{todayCount} of 4 today — log another?`, e.g. "4 of 4 today — log another?"
- both: `Fed {formatRelative(elapsed)}, {todayCount} of 4 today — log another?`

The counter uses the warning style when `todayCount >= DAILY_FEED_TARGET`.

### 7.3 Relative time: `formatRelative(ms)`
Negative values (clock skew) count as 0. Whole units, rounded down.
| Elapsed | Output | Example |
|---|---|---|
| < 60 s | `just now` | just now |
| < 60 min | `{m}m ago` | 12m ago |
| < 24 h | `{h}h {m}m ago` (always both parts) | 1h 40m ago, 2h 0m ago |
| ≥ 24 h | `{d}d {h}h ago` | 1d 3h ago |

Headline = `Last fed ` + formatRelative(…), e.g. "Last fed 1h 40m ago".

### 7.4 Absolute labels (device locale via `Intl.DateTimeFormat(undefined, …)`, examples in en-US)
- **time:** `{hour: 'numeric', minute: '2-digit'}` gives "7:42 AM".
- **`formatFeedLabel(feed, now)`** for home rows and delete sentences:
  - same local day: `Today, 7:42 AM`
  - previous local day: `Yesterday, 9:55 PM`
  - same year: `Mon, Sep 14, 6:30 PM`
  - other year: `Sep 14, 2025, 6:30 PM`
- **History rows:** time only ("7:42 AM").
- **`formatDayHeading(date, now)`:** `Today`, `Yesterday`, `Monday, September 14`, or `Monday, September 14, 2025` in another year.
- **Day key** for grouping and midnight detection: local `YYYY-MM-DD`.

### 7.5 Delete confirmation: `deleteConsequence(target, feeds, todayCount, now)`
`feeds` is the currently loaded live feeds, newest first. On home that's the recent list; on history, all loaded pages.

Sentence 1: `Delete the {L} feed?`, where `L` is the time only if the target is today (e.g. "7:42 AM"), otherwise `formatFeedLabel` (e.g. "Yesterday, 9:55 PM").

Sentence 2 joins the parts that apply, in this order:
1. The target is the newest feed and another feed `N` exists: `Last feed will then show {N's label}.`, with N's label as time only if N is today, else `formatFeedLabel`.
2. The target is the newest feed and no other feed exists: `There will be no feeds left.`
3. The target is today: `Today's count goes from {todayCount} to {todayCount - 1}.`
4. Neither of the above: `Last feed time and today's count won't change.`

Examples:
- "Delete the 7:42 AM feed? Last feed will then show 3:10 AM. Today's count goes from 2 to 1."
- "Delete the Yesterday, 9:55 PM feed? Last feed time and today's count won't change."
- "Delete the 7:42 AM feed? There will be no feeds left. Today's count goes from 1 to 0."

### 7.6 Day boundary (v1.1: 3 AM, not midnight)
```
startOfLocalDay(now) = new Date(now.getFullYear(), now.getMonth(), now.getDate())   // unchanged, still used by formatFeedLabel/formatDayHeading's Today/Yesterday check (§7.4) — those are about the CLOCK day, for display, not the feed day

startOfFeedDay(now):
  shifted = new Date(now.getTime() - FEED_DAY_START_HOUR * 60 * 60 * 1000)  # subtract 3h first
  return new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate(), FEED_DAY_START_HOUR)  # then floor to that shifted day's 3 AM
```
Field-based construction (`getFullYear`/`getMonth`/`getDate`), never raw millisecond subtraction on the final boundary, for the same DST-safety reason as v1's `startOfLocalDay` — the intermediate `shifted` value only picks which calendar day we're floored to, and the returned `Date` is always built from local fields at the real 3:00 AM on that day, so a DST transition can't shift it by an hour. Example: at 2026-09-17 01:30 local (before 3 AM), `shifted` lands on 2026-09-16, so `startOfFeedDay` returns 2026-09-16 03:00 — that 1:30 AM feed belongs to the 16th's feed day, not the 17th's.

**"Today" for the counter and guard (contract.md §7.2, spec.md F8) means `created_at >= startOfFeedDay(now)`.** The count resets exactly at 3:00 AM local, not midnight. A feed at 1:30 AM counts toward the *previous* feed day. An open page notices the boundary crossing on its next tick (§`TICK_MS`) and refreshes, same as v1's midnight check did.

**`feedDayKey(d) = dayKey` of the date `startOfFeedDay` would compute for `d`** — i.e. `dayKey(new Date(d.getTime() - FEED_DAY_START_HOUR * 60*60*1000))`. This is the grouping key for the heatmap (§7.8) and for `groupByDay` in history — **`groupByDay`'s day groups now follow the feed day, not the calendar day**, so a 1:30 AM feed appears under the previous day's heading, consistent with the counter. `formatDayHeading`'s "Today"/"Yesterday"/weekday label logic (§7.4) is unchanged in its wording, but now compares `feedDayKey` values instead of calendar `dayKey` values, so the heading a feed appears under always matches which day its count was added to.

**`formatFeedLabel`'s "Today, 7:42 AM" / "Yesterday, 9:55 PM" wording (§7.4) also switches to `feedDayKey`** for the same reason — a 1:30 AM feed reads "Yesterday, 1:30 AM" once the clock has passed midnight but not yet 3 AM, matching the day it's grouped and counted under. The absolute time shown (`formatTime`) is unaffected either way; only which day-word it's labeled with changes.

### 7.7 Names: `sanitizeName(input)`
Trim, collapse runs of whitespace to one space, cut to `NAME_MAX_LENGTH` characters. An empty result becomes `null`. Display `null` as `Someone`. Always render with `textContent`.

### 7.8 Heatmap bucketing: `buildHeatmap(feeds, now, weeks = HEATMAP_WEEKS)`
Pure function, no DOM. `feeds` is every currently-loaded live feed for the selected pet (§6.F.1), newest first.

**Anchor on today, not on the range start** — this is the one part of this contract that was wrong in an earlier draft (anchoring both ends independently could produce 6 rows on 6 of every 7 weekdays instead of always 5). Anchor only on `gridEnd`, and derive everything else from it, so the row count is always exactly `weeks` regardless of what day of the week `now` falls on:
```
todayKey = feedDayKey(now)
gridEnd   = the Saturday on/after the calendar date of todayKey   # closes out today's row, 0-6 days after today
gridStart = gridEnd minus (weeks * 7 - 1) calendar days            # always a Sunday, by construction

counts = {}                                                        # feedDayKey -> number of feeds
for f in feeds: key = feedDayKey(f.created_at); if key is between gridStart and gridEnd (inclusive): counts[key]++ (ignore feeds outside the range)

cells = []
for each calendar date d from gridStart through gridEnd:
  key = feedDayKey-equivalent for d
  cells.push({ date: d, feedDayKey: key, count: counts[key] or 0,
               inRange: key <= todayKey,      # only trailing cells (today through gridEnd, i.e. the rest of the current week that hasn't happened yet) are inRange:false — there is never LEADING padding, because gridStart is already a Sunday by construction
               isToday: key === todayKey })
return { weeks: cells grouped into rows of 7 (Sun..Sat), bucketed by intensity(count) }
```
Worked check: if today is Thursday, `gridEnd` is the Saturday 2 days later, `gridStart` is `5*7-1 = 34` days before that — 35 calendar days total, always exactly 5 rows of 7. The only `inRange: false` cells are Friday and Saturday of the *current* (bottom) row, since those days haven't happened yet.
`intensity(count)`: `0` → no-feeds tier (lightest/empty), `1` → tier 1, `2` → tier 2, `3` → tier 3, `4+` → tier 4 (the design's 4-tier ramp in design.md §4.1 — matches `DAILY_FEED_TARGET`, so "hit today's target" and "hit the heatmap's top tier" are the same number, deliberately). A day with `inRange: false` is never colored past the empty tier regardless of count (there shouldn't be any, since `feeds` is already pet-scoped and the query range matches, but this keeps padding cells visually inert).

Each cell's date is a **feed day**, not a calendar day: the square labeled with a given date's number represents the 3 AM–to–3 AM window starting that morning, consistent with everything else in §7.6.

### 7.9 CSV export formatting: `feedsToCsv(feeds, pet)`
Pure function. `feeds` is the full array from `getAllFeedsForExport` (§6.F.2, newest first — re-sort to oldest-first here, since a backup log reads more naturally chronologically). `pet` is the `Pet` object feeds are being exported for.
- Header row: `date,pet,time,feeder`
- One row per feed: `date` is `YYYY-MM-DD` for that feed's **feed day** (`feedDayKey`, §7.6 — not the calendar date, for the same reason day-grouping uses it), `pet` is `pet.name`, `time` is `formatTime(created_at)` (§7.4, device locale, e.g. `7:42 AM`), `feeder` is `logged_by` or `Someone`.
- RFC 4180 quoting: wrap a field in `"…"` and double any internal `"` only if the field contains a comma, quote or newline. Names are free text (§7.7), so this matters — a feeder name saved as `Sam, sr.` must round-trip correctly.
- Line endings `\r\n`. File name: `pumo-feed-log-{pet.slug}-{today's feedDayKey}.csv`. MIME type `text/csv`, downloaded via a `Blob` + temporary `<a download>`, no network request.

### 7.10 Pet URL resolution
```
petSlugFromLocation(): reads the `pet` query-string param from `location.search`, e.g. `?pet=banh-mi` -> 'banh-mi'. Absent, empty or unrecognized (not matching any Pet.slug from getPets()) -> DEFAULT_PET_SLUG ('pumo').
pathForPet(slug, page = 'index.html'): slug === DEFAULT_PET_SLUG -> `{page}` (no query string, so Pumo's is the plain LIVE_URL); otherwise `{page}?pet={slug}`.
```
Every in-app link that changes or preserves the pet (the picker, and history.html's back-link) is built with `pathForPet`, never a hand-written string, so the query param is never dropped or duplicated. See design.md §3.0 and architecture.md §10 for where this is used and why the default pet gets no query string (its NFC tag stays the same short URL households already have programmed).

### 7.11 Editing a feed's time: `computeEditedTimestamp(originalIso, timeValue, now)` (v1.2)
Pure function, no DOM, no network. Backs the inline time editor (design.md §3.6b) that opens from the new edit icon next to the row's delete icon (both home's recent rows and history's day-grouped rows — the same shared `createFeedRow` component, contract.md's UI is architecture.md §4's concern, not this file's).

- `timeValue` is a `<input type="time">` element's `.value`: either `''` or a valid 24-hour `"HH:MM"` string. The browser itself refuses to produce anything else, but treat `''` (cleared field) as invalid too.
- **The edited feed keeps its original calendar date** (the local `Y`/`M`/`D` of `new Date(originalIso)`) — only the time-of-day changes. Moving a feed to a *different date* is out of scope (delete and re-log instead); this keeps the picker a single, unambiguous `<input type="time">` rather than a date+time combo.
```
computeEditedTimestamp(originalIso, timeValue, now):
  if timeValue doesn't match /^\d{2}:\d{2}$/: return { ok: false, reason: 'invalid' }
  original = new Date(originalIso)
  [h, m] = timeValue.split(':').map(Number)
  candidate = new Date(original.getFullYear(), original.getMonth(), original.getDate(), h, m, 0, 0)  // field-based, DST-safe — same pattern as §7.6
  if candidate.getTime() > now.getTime() + EDIT_FUTURE_GRACE_MS: return { ok: false, reason: 'future' }
  return { ok: true, iso: candidate.toISOString(), unchanged: candidate.getTime() === original.getTime() }
```
- `reason: 'invalid'` should be unreachable in normal use (the browser's own time input validates this) — if it ever happens, treat it like any other blocked Save, no network call.
- `reason: 'future'` is the one a person can actually trigger (picking a time later than now on today's date). Design.md §3.6b's inline message covers it.
- `unchanged: true` means Save can skip the network call entirely and just close the editor — no PATCH needed for a no-op edit.
- Note the boundary here is the **now/future check**, not the 3 AM feed-day boundary: editing a feed's time can deliberately move it across a feed day (e.g. 11:58 PM → 12:15 AM shifts it into the *next* feed day if that's also before 3 AM the *following* morning — no, more precisely: since the date field never changes, the only way an edit changes which feed day a row falls in is by crossing the 3 AM line within that same fixed calendar date, e.g. 2:50 AM → 3:10 AM on the same date moves it from the previous feed day into that date's own feed day). This is intentional and needs no special handling — `feedDayKey`, the counter, the day-grouped headings and the heatmap all derive live from `created_at` on every render, exactly as they already do after any delete or undo (architecture.md §4).

## 8. Error cases

`api.js` turns every failure into `ApiError { kind, status?, code?, message }`:

| `kind` | Detected by | Meaning |
|---|---|---|
| `offline` | Fetch rejects and `navigator.onLine === false` | The phone has no connection |
| `timeout` | The `AbortController` fired after `REQUEST_TIMEOUT_MS` | Slow network, or the project isn't responding |
| `network` | Fetch rejects (TypeError) while online | DNS or connection failure, or a paused or deleted Supabase project |
| `http` | Response not OK and not the handled 409 | Includes 5xx (often a paused or broken project), 401/403 `42501` (setup or grant mistake) and 404 `PGRST205` or `42P01` (table missing) |

For `http`, parse the JSON body (`{code, message, details, hint}`) when there is one, and `console.error` it in full.

| Scenario | Home behavior | History behavior | Recovery |
|---|---|---|---|
| **Network failure while logging** (any kind) | Button `not-saved`. `pendingLog` keeps its id. No row or undo notice is added. | n/a | Tapping retries with the same id. A 409 `23505` on retry counts as success. |
| **Network failure on first load** | Error panel (design S3), button "Try again" | Error panel (design S11) | Try again repeats the load |
| **Network failure on a focus or retry refresh with data on screen** | Keep the data and show the refresh banner (design S4) | Keep the list and show the same banner | Retry. The 60 s freshness rule still applies to logging. |
| **Network failure on undo or delete** | Undo notice or row in its failed state | Row in its failed state | Retry sends the same PATCH again, which is idempotent |
| **Network failure on a time edit (v1.2)** | Row in its edit-failed state (design.md §3.6b) | Same | Retry sends the same PATCH again, which is idempotent |
| **Time edit's target feed was deleted first (v1.2)** | Not an error (`alreadyDeleted: true`, §6.H). Row shows "This feed was deleted." and refreshes. | Same | n/a |
| **Supabase project paused or unreachable** | Looks like `network`, `timeout` or `http` 5xx. Show the paused hint once `consecutiveFailures >= PAUSED_HINT_AFTER_FAILURES` while online. | Same | Dathan unpauses the project in the dashboard (architecture.md §9). The app recovers on the next retry or focus. |
| **Setup mistake** (401/403 `42501` on normal calls, or 404 `PGRST205`/`42P01`) | Shown to users as the generic unreachable error. The full body goes to the console. | Same | A build defect: QA marks it FAIL and the fix is re-running §2 |
| **Soft delete returns `[]`** | Not an error. Refresh. | Same | n/a |
| **localStorage throws** | Not shown. The name counts as `null` and the prompt as not done, but nothing crashes. | n/a | n/a |

`consecutiveFailures` goes up on any failed request and resets to 0 on any successful one.

## 9. Local storage (the complete list)
| Key | Value | Written when |
|---|---|---|
| `pumo.loggerName` | A sanitized name string | The user saves a name |
| `pumo.namePromptDone` | `'1'` | Save or Skip on the name card |

Nothing about feeds is ever stored in the browser.
