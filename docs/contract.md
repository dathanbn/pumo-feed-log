# Pumo Feed Log: contract

Everything in the app depends on this one interface: **the `public.feeds` table exposed through Supabase's REST API**, plus the shared constants and rules below. The frontend code (`api.js`, `logic.js`, `constants.js`), the unit tests and QA all build against this file. If something here seems wrong during the build, follow it anyway and note the concern. Don't silently deviate.

## 1. The table

| Column | Type | Null | Default | Who writes it | Meaning |
|---|---|---|---|---|---|
| `id` | `uuid` | no (PK) | `gen_random_uuid()` | The phone generates it (see §6.C). The default is a safety net. | Feed identity, and what makes retries safe |
| `created_at` | `timestamptz` | no | `now()` | **The server only.** Anon can't write it. | When the feed happened |
| `logged_by` | `text` | yes | `null` | The phone, on insert only | Display name from that phone's localStorage, or `null` ("Someone") |
| `deleted_at` | `timestamptz` | yes | `null` | The phone, on undo or delete | `null` means a live feed. Non-null means soft-deleted. The value is informational. |

## 2. Exact setup SQL (also `backend/schema.sql`, and identical to architecture.md §7 step 2)

```sql
-- Pumo Feed Log: complete database setup (Supabase / Postgres). Safe to re-run.

create table if not exists public.feeds (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  logged_by   text        null,
  deleted_at  timestamptz null
);

comment on table public.feeds is
  'Pumo Feed Log. One row per feed. Soft delete only: deleted_at not null means deleted.';

-- Row Level Security on.
alter table public.feeds enable row level security;

-- Table privileges. Newer Supabase projects no longer grant these automatically, so set them explicitly.
revoke all on table public.feeds from anon, authenticated;
grant usage on schema public to anon;
grant select on table public.feeds to anon;                  -- anyone with the link can read
grant insert (id, logged_by) on table public.feeds to anon;  -- created_at is always the server's now()
grant update (deleted_at) on table public.feeds to anon;     -- the only edit allowed is soft delete
-- Deliberately no DELETE grant: rows can never be hard-deleted through the API.

-- Permissive RLS policies for the anon role.
drop policy if exists feeds_anon_select on public.feeds;
create policy feeds_anon_select on public.feeds for select to anon using (true);

drop policy if exists feeds_anon_insert on public.feeds;
create policy feeds_anon_insert on public.feeds for insert to anon with check (true);

drop policy if exists feeds_anon_update on public.feeds;
create policy feeds_anon_update on public.feeds for update to anon using (true) with check (true);
-- Deliberately no DELETE policy.
```

## 3. What the anon role (publishable key) can and cannot do

| Action | Allowed | Enforced by |
|---|---|---|
| Read any row, including soft-deleted rows | Yes | `grant select` plus the select policy. The app filters out deleted rows itself. |
| Insert with `id` and/or `logged_by` | Yes | Column grant plus the insert policy |
| Insert that sets `created_at` or `deleted_at` | **No** (401/403, `42501`) | Column grant |
| Update `deleted_at` (set or clear) | Yes | Column grant plus the update policy |
| Update `id`, `created_at` or `logged_by` | **No** (401/403, `42501`) | Column grant |
| `DELETE` | **No** (401/403, `42501`) | No grant and no policy |

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
export const PUMO_PHOTO_URL = null; // or 'assets/pumo.jpg' when Dathan supplied a photo
```

## 5. Example feed row (as the API returns it)

```json
{
  "id": "5f0c3a7e-2b1d-4c1e-9a4f-7d2e8b6c1a90",
  "created_at": "2026-09-16T14:42:07.318912+00:00",
  "logged_by": "Sam",
  "deleted_at": null
}
```
The JS type used throughout the app: `Feed = { id: string, created_at: string, logged_by: string | null, deleted_at?: string | null }`.

## 6. Operations

`api.js` exports exactly these four functions. Every one of them either resolves with the shape shown or throws an `ApiError` (§8).

### A. Get last 3 feeds + B. get today's count (together: `getHomeData(now: Date)`)
Both requests run in parallel, and both must succeed.

**A. Last 3 feeds**
```
GET {SUPABASE_URL}/rest/v1/feeds?select=id,created_at,logged_by&deleted_at=is.null&order=created_at.desc&limit=3
```
Response `200`:
```json
[
  { "id": "5f0c3a7e-2b1d-4c1e-9a4f-7d2e8b6c1a90", "created_at": "2026-09-16T14:42:07.318912+00:00", "logged_by": "Sam" },
  { "id": "a1d2e3f4-0000-4b5c-8d9e-112233445566", "created_at": "2026-09-16T10:10:51.004211+00:00", "logged_by": null },
  { "id": "0b9c8d7e-6f5a-4b3c-9d2e-1f0a9b8c7d6e", "created_at": "2026-09-16T04:55:13.771020+00:00", "logged_by": "Alex" }
]
```
It returns 0–3 items, newest first. `[]` means there are no feeds yet.

**B. Today's count**
`since` = `startOfLocalDay(now).toISOString()`. In Pacific Daylight Time on 2026-09-16 that is `2026-09-16T07:00:00.000Z`.
```
GET {SUPABASE_URL}/rest/v1/feeds?select=id&deleted_at=is.null&created_at=gte.2026-09-16T07%3A00%3A00.000Z
```
Response `200`: `[{ "id": "…" }, { "id": "…" }, { "id": "…" }]`. `todayCount` is the array's length.

**`getHomeData` resolves to:**
```json
{ "recent": [ /* ≤3 Feed, newest first */ ], "todayCount": 3, "loadedAt": 1789569727318 }
```
`loadedAt` is `Date.now()` when both responses have arrived.

### C. Log a new feed: `logFeed({ id, logged_by })`
The phone generates `id` once per log attempt with `newFeedId()`. That's `crypto.randomUUID()`, or an RFC 4122 v4 UUID built from `crypto.getRandomValues` when `randomUUID` is missing. A retry of the same attempt **reuses the same id**.
```
POST {SUPABASE_URL}/rest/v1/feeds
apikey: {key}
Content-Type: application/json
Prefer: return=representation

{"id":"5f0c3a7e-2b1d-4c1e-9a4f-7d2e8b6c1a90","logged_by":"Sam"}
```
- `logged_by` is `null` when the phone has no name. **Never send `created_at` or `deleted_at`.**
- **`201`:** `[ { "id": "5f0c…", "created_at": "2026-09-16T14:42:07.318912+00:00", "logged_by": "Sam", "deleted_at": null } ]`. Resolve with the first element.
- **`409` with body `{"code":"23505", …}`:** this id already exists, meaning an earlier try reached the database but its response was lost. Treat it as **success**. Fetch the row and resolve with it:
  ```
  GET {SUPABASE_URL}/rest/v1/feeds?select=id,created_at,logged_by,deleted_at&id=eq.5f0c3a7e-2b1d-4c1e-9a4f-7d2e8b6c1a90
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

### E. History page: `getHistoryPage({ before })`
First page:
```
GET {SUPABASE_URL}/rest/v1/feeds?select=id,created_at,logged_by&deleted_at=is.null&order=created_at.desc&limit=100
```
Next page. `before` is the `created_at` of the oldest feed loaded so far, encoded:
```
GET {SUPABASE_URL}/rest/v1/feeds?select=id,created_at,logged_by&deleted_at=is.null&order=created_at.desc&limit=100&created_at=lt.2026-06-02T08%3A14%3A09.120044%2B00%3A00
```
Resolves to `{ "feeds": [ /* Feed, newest first */ ], "hasMore": true }`, where `hasMore` is `feeds.length === HISTORY_PAGE_SIZE`.

### F. Calls that must fail (QA and preflight only; the app never makes them)
| Call | Expected |
|---|---|
| `DELETE {SUPABASE_URL}/rest/v1/feeds?id=eq.{id}` | 401 or 403, `code: "42501"`, and the row still exists |
| `POST /rest/v1/feeds` body `{"logged_by":"QA-test","created_at":"2020-01-01T00:00:00Z"}` | 401 or 403, `code: "42501"` |
| `PATCH /rest/v1/feeds?id=eq.{id}` body `{"created_at":"2020-01-01T00:00:00Z"}` | 401 or 403, `code: "42501"` |

## 7. Shared constants and rules

### 7.1 `frontend/js/constants.js` (exact)
```js
export const RECENT_FEED_GUARD_MS = 2 * 60 * 60 * 1000; // 7_200_000 ms. Dathan's 2-hour window (NOT 60 min)
export const DAILY_FEED_TARGET = 4;                     // "n of 4 today"; guard applies when n >= 4
export const DAY_BOUNDARY = 'local-midnight';           // documentation: day starts 00:00 in the viewing phone's time zone
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

### 7.6 Day boundary
`startOfLocalDay(now) = new Date(now.getFullYear(), now.getMonth(), now.getDate())`. That is 00:00:00.000 in the phone's current time zone, and it handles DST correctly. "Today" means `created_at >= startOfLocalDay(now)`. The count resets exactly at local midnight. An open page notices the date change on its next tick and refreshes.

### 7.7 Names: `sanitizeName(input)`
Trim, collapse runs of whitespace to one space, cut to `NAME_MAX_LENGTH` characters. An empty result becomes `null`. Display `null` as `Someone`. Always render with `textContent`.

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
