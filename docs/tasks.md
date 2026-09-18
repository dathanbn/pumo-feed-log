# Pumo Feed Log: build tasks

**v1.1 addendum:** this build adds multi-pet support (F17), the history heatmap (F18) and CSV export (F19) to an already-shipped v1. The team split, ground rules and task numbering below are unchanged from v1 — read them as still current, with the v1.1-tagged additions layered in at Task 1 (schema migration), Task 2 (new UI/logic), Task 3 (new unit tests) and the QA section (new ACs, new screenshots). There is no separate v1.1 team; the same Frontend and QA agents cover the whole current scope, since most of v1's code is being extended in place rather than replaced.

**v1.2 addendum:** three small, unrelated additions to the shipped v1.1 app: real photos for Zuumi and Banh Mi (F20), editing a feed's logged time (F21), and restyling/repositioning the CSV button (F19's AC-19.6). **Unlike v1 and v1.1, the PM applied this round's one-time database change directly** (widening the `created_at` update grant, adding the `feeds_created_at_not_future` check, and updating the 3 pet rows' `photo_url` — all now live on the real Supabase project and reflected in `backend/schema.sql`/contract.md §2) — it was a 3-statement change with no schema redesign, so there was nothing for a build agent to design or decide. Task 1 below is **already done**; the Frontend agent's job starts from the already-migrated database and just needs to build against contract.md §6.H/§7.11 as given. Task 2 and Task 3 get the v1.2-tagged additions below; there is no new Task 1 work and no new agent — same Frontend and QA agents as before.

**v1.3 addendum:** a small polish pass (F22) on top of v1.2 — three UI-only tweaks, no schema change: the CSV button drops its visible label and moves inline with the heatmap legend (AC-22.1), the exported CSV switches to newest-first row order (AC-22.2), and Zuumi's/Banh Mi's picker photos are re-cropped (nose centered, AC-22.3) at a slightly larger avatar size (AC-22.4). **The PM built this round directly** (frontend code, unit test, e2e spec updates, and the photo re-crop script) rather than dispatching Frontend/QA agents — the whole scope was small and contained enough (no new database work, no new acceptance-criteria surface beyond F22's four items) that splitting it across a team would have cost more in coordination than it saved. Verification followed the same bar as a dispatched round would: the full unit suite re-run clean (79/79, both `TZ=America/Los_Angeles` and `TZ=UTC`), the mocked e2e specs touched by this change re-run against a local static server (`LIVE_URL` unset), and fresh screenshots reviewed before shipping. Real-network e2e specs remain blocked by this sandbox's egress allowlist (pre-existing, documented in earlier QA rounds) and were not re-run; nothing in this round's changes touches server-side behavior for them to catch.

## 0. Team, order, ground rules

**Decision: option (a). The Supabase schema and policies are a one-time setup task owned by the frontend agent. There is no separate backend or logic agent.** It's about 25 lines of config SQL applied once plus two copied values, with no server code. A second agent would only add a handoff and a second owner of the same four REST calls, with nothing to do in parallel.

| Order | Agent | Tasks |
|---|---|---|
| 1 | Frontend agent | Task 1 (Supabase setup and preflight), Tasks 2–5 (build, unit tests, assets, deploy) |
| 2 | QA agent | Verify every [QA] criterion against the live deploy, then write the report |
| 3 | Fix loop | Frontend fixes → QA re-checks (§3) |

**Ground rules for every agent**
- Read all of `docs/` first. Where files seem to disagree: `contract.md` wins on data, constants and formatting, `design.md` on visuals and copy, `spec.md` on behavior.
- Nobody asks Dathan anything. If something is genuinely unclear, pick the option that best protects **"never double-feed Pumo, never lose a record"**, and write the choice under "Build notes" in the hand-off.
- Nothing from spec.md §5 gets built, and cut items get no hooks.
- Never commit a Supabase secret key, service_role key or database password.
- Test data uses only `logged_by` values `Build-test` (frontend agent) and `QA-test` (QA agent), and each agent soft-deletes its own rows before finishing.

---

## 1. Frontend agent

### Goal
A deployed, working Pumo Feed Log at LIVE_URL that meets every behavior in spec.md F2–F16, backed by a correctly configured Supabase `feeds` table.

### Owns
- `frontend/` (all of it)
- `backend/schema.sql`
- `tests/unit/`
- `.github/workflows/deploy-pages.yml` (only if `HOSTING = github-pages`)
- The §8 values table in `docs/architecture.md`, only when filling in Supabase values on the MCP path

It does **not** touch `tests/e2e/`, `tests/screenshots/` or `tests/qa-report.md`.

### Responsible for (implements; QA verifies)
- AC-1.3
- AC-2.1–2.5, AC-3.1–3.2, AC-4.1–4.5, AC-5.1–5.2, AC-6.1–6.4
- AC-7.1–7.8, AC-8.1–8.5, AC-9.1–9.5, AC-10.1–10.5, AC-11.1–11.3
- AC-12.1–12.4, AC-13.1–13.2, AC-14.1–14.6, AC-15.1, AC-16.1–16.6
- **v1.1: AC-17.1–17.7, AC-18.1–18.7, AC-19.1–19.5** (AC-17.8 is [DATHAN] — sticker programming, not built)
- Owns outright: the [UNIT] parts of AC-7.3 and AC-8.5 (**and, v1.1, AC-8.5's new 3 AM/midnight-to-3AM cases**)

### Task 1: Supabase setup and preflight (config, not code)
1. Write `backend/schema.sql` exactly as in `contract.md` §2 — **this is the v1.1 schema**, i.e. it includes the `pets` table and the `feeds.pet_id` migration, not just the original `feeds` table. Since the live project already has v1's `feeds` table populated with real rows, this step is a **migration against a live database**, not a fresh create — the SQL is written to be safe either way (see contract.md §2's comment).
2. The project already exists (`dufyzxtrhdcwrebagsfs`, "Pumo Feeder", per `docs/architecture.md` §8) — use the Supabase MCP tools directly against it, no `create_project` step:
   1. `apply_migration` (name `add_pets_and_pet_id`, SQL = `backend/schema.sql`)
   2. Confirm via `execute_sql`: `select slug, name from public.pets order by sort_order;` returns exactly Pumo, Zuumi, Banh Mi, and `select count(*) from public.feeds where pet_id is null;` returns `0`.
3. **Preflight — v1.1 additions on top of the original 6 checks** (run all of these with `curl`, paste status codes and bodies into the hand-off):
   1. GET `pets` (contract §6.G) → `200` with 3 rows.
   2. GET "last 3" for Pumo's `pet_id` (contract §6.A) → `200` with a JSON array.
   3. POST `{"id":"<new uuid>","pet_id":"<zuumi's id>","logged_by":"Build-test"}` → `201` with the row, including a server `created_at` and the right `pet_id`.
   4. POST the **same** id again → `409`, code `23505`.
   5. POST with `created_at` (contract §6.F) → `401`/`403`, code `42501`.
   6. POST to `/rest/v1/pets` (contract §6.F) → `401`/`403`, code `42501`.
   7. PATCH soft-delete on the row from 3.3 → `200` with `deleted_at` set. Repeating it → `200 []`.
   8. DELETE on that row → `401`/`403`, code `42501`. A GET by id still returns it.
4. **If the preflight fails:**
   - Re-apply `backend/schema.sql` with `execute_sql`, run `notify pgrst, 'reload schema';`, and retry once.
   - **Still failing:** stop the build and report **BLOCKED**, naming the exact failing call.

### Task 2: Build the app
Build to `architecture.md` §3–§4, `design.md` and `contract.md`:
1. **`index.html` and `history.html`**
   - Semantic markup per design.md §7.
   - `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
   - `<meta name="color-scheme" content="light dark">`, and two `theme-color` metas (`#FBF7F2` and `#1A1614` with media queries).
   - `<meta name="robots" content="noindex">`.
   - Icon links per design.md §8.
   - Modules loaded with `<script type="module">`. All paths relative.
   - A `data-app="pumo-feed-log"` attribute on `<body>`.
2. **`css/styles.css`:** tokens, type, spacing, the button states from design.md §3.4, the reduced-motion overrides, and a single centered column at most 440 px wide.
3. **`js/constants.js`:** exactly contract.md §7.1 (now includes `FEED_DAY_START_HOUR`, `HEATMAP_WEEKS`, `DEFAULT_PET_SLUG`, and **v1.2's `EDIT_FUTURE_GRACE_MS`**). **`js/config.js`:** per contract.md §4 — **v1.1: two values only, no `PUMO_PHOTO_URL`** (that's now `pets.photo_url` in the database, seeded by the schema migration in Task 1).
4. **`js/logic.js`:** every function listed in architecture.md §4, following contract.md §7 to the letter. `now` is always a parameter. **v1.1 additions:** `startOfFeedDay`/`feedDayKey` (§7.6), `buildHeatmap` (§7.8), `feedsToCsv` (§7.9), `petSlugFromLocation`/`pathForPet` (§7.10) — and every existing function that used calendar-day grouping (`groupByDay`, `formatFeedLabel`, `formatDayHeading`) now uses `feedDayKey` instead, per §7.6. **v1.2 addition:** `computeEditedTimestamp` (§7.11) — pure, field-based (DST-safe, same pattern as `startOfFeedDay`), keeps the original date and only swaps the time-of-day; enforces the future-time grace window client-side (the DB's `feeds_created_at_not_future` check is the backstop, not the primary UX).
5. **`js/api.js`:** the operations and error normalization from contract.md §6 and §8. It must never send `created_at` on insert, never send `pet_id` or `logged_by` in a PATCH, and never use `DELETE`. **v1.1 additions:** `getPets` (§6.G), `getAllFeedsForExport` (§6.F.2); every existing call that touches `feeds` now filters by `pet_id` (§6.A, §6.B, §6.E) and `logFeed`'s body now includes `pet_id` (§6.C). **v1.2 addition:** `updateFeedTime(id, newIso)` (§6.H) — same idempotent, id-only, `deleted_at=is.null`-filtered PATCH shape as `softDeleteFeed`, resolving `{ alreadyDeleted: true }` on an empty `[]` response.
6. **`js/storage.js`:** contract.md §9, with every access wrapped in try/catch. **Unchanged by v1.1 and v1.2** — pet selection is URL-only, never localStorage (architecture.md §4's `storage.js` row).
7. **`js/ui.js`:**
   - The status region.
   - `onFocusRefresh`: `visibilitychange`→visible, `focus`, and `pageshow`, debounced.
   - The shared feed row with inline delete confirmation (design.md §3.6), its focus handling and Escape.
   - Error panel and refresh banner.
   - **v1.1:** the pet-picker renderer (design.md §3.0) and the heatmap grid/cell renderer (design.md §4.1), shared between home.js and history.js per architecture.md §4.
   - **v1.2:** the inline edit-time flow on the same shared row component (design.md §3.6b) — a new Edit icon button next to Delete, and an `editing`/`saving-edit`/`edit-failed` state machine on the row sharing the module-level "one open row at a time" controller with the existing delete-confirm states. Reuse the delete flow's Cancel/Escape/focus-management pattern rather than writing a parallel one. `renderHeatmap()` now targets `#heatmap-content` (a child of `#heatmap-card`, not the card itself) per architecture.md §4's DOM-shape note, so the CSV button's new `.heatmap__header` survives the heatmap's own re-renders.
8. **`js/home.js`**
   - The button state machine exactly as in architecture.md §4, with the 6 s arm timeout and the revert on hide.
   - The 30 s tick: relative labels, ready/guarded, and feed-day-boundary detection (3 AM, not midnight — contract.md §7.6) → refresh.
   - The undo notice (design.md §3.5).
   - The name card and footer (design.md §3.7).
   - All the states in design.md §6 (S1–S8, S13, S14).
   - **v1.1:** resolve the pet from the URL (`petSlugFromLocation` + `getPets`) before the first render, render the picker (design.md §3.0), and scope every `api.js` call to that pet's id.
   - **v1.2:** wire the recent list's rows to `api.updateFeedTime` via the new edit flow in `ui.js`; a successful edit triggers the same full `render()` (not a partial patch) that a delete already does, so the counter/headline/recent-list stay consistent (states S17–S19).
9. **`js/history.js`:** day groups with counts, paging with "Show older feeds", delete confirmation, a focus refresh that reloads the first page and drops the older pages, and states S9–S13. **v1.1:** the same pet resolution as home.js; the heatmap (design.md §4.1, states S16) built from the loaded feeds via `buildHeatmap`; the Download CSV button (design.md §4.2, states S15) calling `getAllFeedsForExport` + `feedsToCsv` and triggering a client-side download. **v1.2:** the day-grouped list's rows get the same edit flow as home's recent list (states S17–S19); the CSV button moves into `#heatmap-card`'s new `.heatmap__header` (design.md §4.1/§4.2) — restyled `.btn--text`, short "CSV" label, unchanged `aria-label` and busy-state behavior, and its `hidden` toggling now follows `#heatmap-card`'s own (architecture.md §4's DOM-shape note) instead of being set independently.
10. **Self-review checks:**
    - `grep` finds no `innerHTML` assignments that include feed or name data.
    - No `'DELETE'` string anywhere in `frontend/js`.
    - No `created_at` in any insert request body; no `pet_id` or `logged_by` in any PATCH body.
    - No number literals that duplicate constants.
    - **v1.1:** no `PUMO_PHOTO_URL` or other pet-specific literal anywhere in `frontend/js` (grep for `pumo`/`zuumi`/`banh` outside of `constants.js`'s `DEFAULT_PET_SLUG` and test files turns up nothing hardcoded — pet data always comes from `getPets()`). Every `feeds` query in `api.js` includes a `pet_id=eq.` filter except `getPets` itself (which queries `pets`, not `feeds`).
    - **v1.2:** the Edit and Delete icon buttons are each independently keyboard-reachable with distinct `aria-label`s; re-verify AC-2.3a's 375×553 budget with both icons present in a row (design.md §3.1's note).

### Task 3: Unit tests (`tests/unit/logic.test.mjs`, run with `node --test tests/unit`)
The suite must pass with both `TZ=America/Los_Angeles` and `TZ=UTC`. Cover at least:
- **`guardState`:**
  - Elapsed 1h 59m 59s → recent; exactly 2h 00m 00s → not recent.
  - todayCount 3 → not daily; 4 → daily.
  - Both at once, and no feeds at all.
  - Negative elapsed (clock skew) counts as 0.
- **`armedLabel`:** all three variants, word for word as in contract.md §7.2.
- **`formatRelative`:** 0 s, 59 s, 60 s, 59 m, 60 m ("1h 0m ago"), 23h 59m, 24 h ("1d 0h ago").
- **`startOfLocalDay`:** a normal day, 2026-03-08 and 2026-11-01 in `America/Los_Angeles`, and a feed at 23:59:59.999 vs 00:00:00.000. (This function is kept for calendar-day display logic that's independent of the feed day, per contract.md §7.6 — it is not deleted in v1.1.)
- **`startOfFeedDay` / `feedDayKey` (v1.1, contract.md §7.6):**
  - A feed at 2:59:59.999 AM belongs to the *previous* feed day; one at 3:00:00.000 AM belongs to the current one.
  - 2026-03-08 and 2026-11-01 in `America/Los_Angeles` (the DST transition days), each with a case for a feed logged between midnight and 3 AM.
  - `feedDayKey` agrees with `startOfFeedDay` at the boundary (no off-by-one between the two).
- **`groupByDay`:** feeds on both sides of the **feed-day** boundary (3 AM, not midnight, v1.1), ordering, counts.
- **`deleteConsequence`:** every case and example in contract.md §7.5.
- **`sanitizeName`:** trimming, collapsing whitespace, 20-character cut, empty → `null`, HTML-looking input kept as literal text.
- **`newFeedId`:** a v4 UUID format with and without `crypto.randomUUID` available.
- **`buildHeatmap` (v1.1, contract.md §7.8):**
  - Sunday always lands in column 0 regardless of what day `now` falls on — assert this for at least 3 different `now` values landing on different weekdays.
  - A day with exactly `DAILY_FEED_TARGET` (4) feeds gets the top tier; 3 gets the tier below it; 0 gets the empty tier.
  - Padding cells before the range start are marked `inRange: false` and never colored past the empty tier even if (by construction) they'd otherwise match a date with feeds.
  - Uses feed-day bucketing (a 1:30 AM feed lands on the previous day's cell), consistent with `groupByDay`.
- **`feedsToCsv` (v1.1, contract.md §7.9):**
  - Header row exact text `date,pet,time,feeder`.
  - A feeder name containing a comma and a double quote round-trips (gets quoted/escaped per RFC 4180).
  - `null` `logged_by` renders as `Someone`.
  - Row order is oldest-first (reversed from the newest-first input).
  - Date column uses the feed day, not the calendar day, for a 1:30 AM feed.
- **`petSlugFromLocation` / `pathForPet` (v1.1, contract.md §7.10):**
  - No `?pet=` param, an empty one, and an unrecognized slug all resolve to `DEFAULT_PET_SLUG`.
  - `pathForPet(DEFAULT_PET_SLUG)` returns the bare page name with no query string; any other slug returns `{page}?pet={slug}`.
- **`computeEditedTimestamp` (v1.2, contract.md §7.11):**
  - A valid past-today time returns `{ ok: true, iso, unchanged: false }` with the original calendar date preserved (assert the date fields, not just that it parses).
  - The exact original time round-trips to `{ unchanged: true }`.
  - A time more than `EDIT_FUTURE_GRACE_MS` past `now` on today's date returns `{ ok: false, reason: 'future' }`; a time within the grace window (e.g. 2 minutes ahead) is accepted.
  - An empty string and a malformed value (not matching `HH:MM`) both return `{ ok: false, reason: 'invalid' }`.
  - 2026-03-08 and 2026-11-01 in `America/Los_Angeles` (the DST transition days): editing a feed originally logged on one of those dates to a new time still lands on the same calendar date, field-based construction (no raw millisecond math).

### Task 4: Assets (design.md §8)
- Hand-write `frontend/assets/icon.svg`.
- Generate `apple-touch-icon.png` (180×180, opaque) and `favicon-32.png` from it. Use whichever is available: Playwright/Chromium screenshot, `rsvg-convert`, ImageMagick, or Python PIL with cairosvg.
- If `docs/assets/icon.png` exists, generate both PNGs from it instead, keeping `icon.svg` as the favicon and avatar fallback.
- If `docs/assets/pumo.jpg` exists: center-crop to a square, resize to 256×256, **strip EXIF**, keep it under 100 KB, and save to `frontend/assets/pumo.jpg`.
- **v1.2, already done by the PM, nothing to build here:** `frontend/assets/zuumi.jpg` and `frontend/assets/banh-mi.jpg` exist (176×176, matching `pumo.jpg`'s own dimensions) and `pets.photo_url` is already set for all 3 rows on the live database. Confirm both files are present in the repo and that `getPets()` returns real paths for all 3 pets during preflight — don't regenerate or re-crop them.

### Task 5: Deploy
1. Write the current ISO timestamp to `frontend/build.txt`. Commit with a clear message and push to `main`.
2. If `HOSTING = github-pages`, first add `.github/workflows/deploy-pages.yml` (architecture.md §6).
3. Poll `LIVE_URL/build.txt` every 15 s, for up to 10 minutes, until it matches the commit.
4. **If pushing to `main` isn't allowed** in this environment: push a branch and open a PR to `main`.
   - **Cloudflare:** give QA the branch preview URL `https://<branch-alias>.<project>.pages.dev`. The alias is the branch name lowercased, with non-alphanumerics turned into `-`.
   - **GitHub Pages:** give QA a local static server (`python3 -m http.server 8080 --directory frontend`) and list the deploy-dependent criteria (AC-1.3) as BLOCKED.
   - Either way, tell Dathan in the final report to merge the PR.
5. Soft-delete all `Build-test` rows with a PATCH filtered by `logged_by=eq.Build-test&deleted_at=is.null`.

### Done means (all checkable)
- [ ] `backend/schema.sql` is byte-identical to the SQL in contract.md §2, and all preflight calls (v1.1: 8; **v1.2: re-run against the already-migrated live DB, plus the two new must-fail rows for a future `created_at` and a `pet_id`/`logged_by` PATCH**) returned the expected codes (outputs in the hand-off).
- [ ] `node --test tests/unit` passes under `TZ=America/Los_Angeles` and `TZ=UTC`, including the v1.1 and v1.2 cases (Task 3).
- [ ] `LIVE_URL/build.txt` (or the agreed fallback URL) matches the final commit.
- [ ] In two separate Playwright browser contexts at 390×844: tapping Log a feed in context A shows "Logged" within 1 s, and reloading context B shows the feed at the top of Recent. Repeat this once for a non-default pet (`?pet=zuumi`) to confirm scoping isn't accidentally shared across pets.
- [ ] A feed 1h 55m old (browser clock moved forward) arms on the first tap. One 2h 05m old logs on the first tap.
- [ ] Home and history load with zero console errors, in light and dark, for all 3 pets.
- [ ] The Task 2 step 10 grep checks are clean.
- [ ] No `Build-test` rows remain undeleted.
- [ ] **v1.1:** the pet picker, heatmap and CSV button all render and work for all 3 pets; switching pets never shows another pet's data even briefly during the navigation.
- [ ] **v1.2:** Zuumi's and Banh Mi's picker avatars show their real photos (not the placeholder). Editing a feed's time works on both home and history, updates the counter/heading/heatmap within 1 s, rejects a future time client-side, and handles a concurrently-deleted target gracefully. The CSV button renders inside the heatmap card's header, top-right, in its new subtle style, and still functions identically otherwise.
- [ ] The hand-off to QA includes: LIVE_URL (or fallback URL), build.txt value, preflight outputs, each pet's URL (architecture.md §10), and Build notes (any judgment calls made — flag the AC-18.5/AC-19.4 "frontend agent's call" items from spec.md explicitly here).

---

## 2. QA agent

### Goal
Independently prove, on the real Supabase project and the real deploy, that every [QA] criterion in spec.md passes, that every state in design.md §6 looks as specified, and record the evidence.

### Owns
`tests/e2e/`, `tests/screenshots/`, `tests/qa-report.md`. It **does not edit** `frontend/` or `backend/`. Defects go back to the frontend agent.

### Responsible for
Verifying every **[QA]** criterion in spec.md (AC-1.3 through AC-16.6, **v1.1's AC-17.1–19.5, and v1.2's AC-19.6, AC-20.1–20.2, AC-21.1–21.8**), reviewing that the **[UNIT]** tests exist and pass, and writing the **[DATHAN]** checklist (**v1.1 adds AC-17.8**, programming Zuumi's and Banh Mi's stickers; v1.2 adds none — F20/F21 are fully verifiable by QA, no real-phone-only step).

### Setup
- **Tooling:** Playwright with Chromium and `@axe-core/playwright`, installed under `tests/e2e/` (its own `package.json` there is fine).
- **Viewports:**
  - `iPhone 13` device descriptor (390×844), used for most tests
  - 375×553 and 390×664 for AC-2.3
  - 1440×900 for AC-16.3
- **Environment:**
  - Color schemes: `colorScheme: 'light'` and `'dark'`.
  - `timezoneId`: use `America/Los_Angeles`. For scenarios that must stay inside one local day (AC-7.2, 8.3, 8.4), pick a `timezoneId` where the current real time is between 06:00 and 18:00 local, and record which one was used.
  - **Multiple devices** = separate `browser.newContext()` instances (no shared storage).
- **Clock control:** real rows always get real server `created_at`. Move time on the *client* with Playwright's clock API (`page.clock.install({ time })` before `goto`, then `setSystemTime`, `fastForward` or `runFor`), set relative to the real `created_at` of the rows being tested.
- **Fault injection:**
  - Offline: `context.setOffline(true)`.
  - Latency: `page.route` that waits 3 s, then `route.continue()`.
  - Failure: `route.abort('failed')`, or `route.fulfill({ status: 503 })`.
  - **Lost response:** `page.route` handler doing `await route.fetch()` followed by `route.abort('failed')`, on the first POST only.
  - Timeout: route that never responds (clock `fastForward` past 10 s).
- **Visibility and focus:** use a real tab switch where headless supports it. Otherwise dispatch the events from `page.evaluate`, overriding `document.visibilityState` → `'hidden'`, firing `visibilitychange`, then `'visible'` and firing it again, plus `window` `focus` and a `pageshow` with `persisted: true`.
- **Data hygiene:**
  - Set `localStorage['pumo.loggerName'] = 'QA-test'` in test contexts (except the name-card tests).
  - **Before each scenario**, soft-delete every live `QA-test` row (across all 3 pets) with a REST PATCH, so counts and guards start clean.
  - For S1 and S10 (zero feeds): if live rows exist that aren't test rows, don't touch them. Intercept the GETs to return `[]` instead, and note that in the report.
  - For AC-12.3, create 101 `QA-test` rows by REST POST (all for one pet — Pumo is fine), then soft-delete them.
  - **v1.1:** every `QA-test` row must include a valid `pet_id` (insert will 400 without one — the column is `not null`). For AC-18's heatmap ACs, seed a small, deliberate spread of `QA-test` rows across several of the last `HEATMAP_WEEKS` weeks (including at least one day at each tier: 0, 1, 2, 3, 4+) for one pet, so the heatmap has real structure to screenshot and assert against, then soft-delete them after.
  - **v1.2:** the DB now allows `PATCH .../feeds` to set `created_at` (contract.md §1/§3) — direct-REST test rows created for editing scenarios must still be cleaned up the same way (soft-delete by `logged_by=eq.QA-test`), since editing a row's time doesn't change how it's found and deleted. For AC-21.4's future-time rejection, use a REST PATCH directly (not just through the UI) to also confirm the `feeds_created_at_not_future` DB constraint itself fires (contract.md §6's must-fail table) — this is one of the "calls that must fail" checks, not only a UI-level assertion.

### What to verify
1. **Every [QA] criterion, in spec.md order.** For each, record PASS, FAIL or BLOCKED, the evidence (screenshot names, script name and line) and notes.
2. **Direct REST checks:** AC-5.2, AC-11.1, AC-11.2 (contract.md §6.F).
3. **Source checks:** AC-11.3 (grep) and AC-6.1 (every fetch uses `cache: 'no-store'`; confirm in `read_network_requests` or Playwright request logs).
4. **Every state S1–S14 in design.md §6,** in light mode, plus dark mode for S1, S3, S5 and the normal filled home, guarded and armed states. Check that the copy matches design.md §5 word for word.
5. **Accessibility (AC-16.6):**
   - axe scan of home (normal, armed, delete-confirm) and history, in both schemes.
   - Tab through every control and confirm the focus ring is visible.
   - Check tap-target sizes with `boundingBox()`: at least 44×44, and the Log button at least 64 px tall.
6. **Unit tests:** run `node --test tests/unit` under both time zones and report the result.
7. **Performance (AC-3.2):** time from click to the "Logged" label in 5 trials in a row. Report each time, and every one must be ≤ 1000 ms.

### Screenshots (`tests/screenshots/`)
- Name: `{NN}-{screen}-{state}-{before|after}-{light|dark}.png`, where `before`/`after` means before and after the action being tested. Omit it for static states.
- If a defect is fixed and re-tested, add `-after-fix`.
- **Minimum set:**
  - S1 home empty (light and dark), S2 home loading, home with 3 feeds (light and dark)
  - Guarded resting, armed before/after tap, saving, logged and undo notice
  - Undo before/after, undo failed
  - Not saved (S5), load error (S3), refresh banner (S4), paused hint (S13)
  - Counter warning at 4 and at 5
  - Delete confirmation before/after on home and on history, delete failed
  - Name card, footer with a name
  - History grouped (light and dark), history empty (S10), history loading (S9), history error (S11), show-older error (S12)
  - Desktop at 1440 px, and 375×553 showing AC-2.3 (**v1.1: re-verify AC-2.3 still holds with the picker row present, per design.md §3.1's note — screenshot it specifically**)
  - **v1.1:** pet picker on home, for all 3 pets, light and dark (showing the selected-pet ring and the placeholder avatars for Zuumi/Banh Mi)
  - **v1.1:** heatmap on history, light and dark, with a visible spread of tiers (per the seeded QA-test data above), plus one screenshot of an expanded day cell
  - **v1.1:** Download CSV button resting, in-flight ("Preparing…"), and failed (S15) states
  - **v1.1:** a feed logged between midnight and 3 AM, showing "Yesterday, {time}" on home and in its history day group (AC-8.5)
  - **v1.2:** pet picker showing Zuumi's and Banh Mi's real photos (no more placeholder), on home
  - **v1.2:** the edit-time flow open (input pre-filled) and its future-time-rejected error, on a home row and a history row; edit-failed and "this feed was deleted" states
  - **v1.2:** the restyled/repositioned CSV button in the heatmap card's header, resting and in-flight, light and dark

### `tests/qa-report.md` structure
1. Header: tested URL, `build.txt` value, date and time, Supabase project ref (from the URL), browsers and devices, time zones used.
2. Summary counts: PASS / FAIL / BLOCKED / DATHAN.
3. Results table: `AC | Result | Evidence | Notes`, one row per criterion, including the [UNIT] and [DATHAN] ones (mark those UNIT-PASS or DATHAN).
4. Defects: for each FAIL, the steps to reproduce, expected result, actual result and screenshot.
5. Build notes: copied from the frontend agent's hand-off.
6. **Dathan's post-deploy checklist (real phones):**
   - AC-1.1 and AC-1.2 (architecture.md §7 step 9)
   - AC-6.2 on a real iPhone (Safari) and a real Android phone (Chrome): open the app, switch apps, log from another phone, come back, and the feed should show within 2 s
   - Set a name on each of the 4 phones
   - Dark mode looks right on each phone
   - One real feed, undo, and one delete done end to end
7. Test data: confirmation that all `QA-test` rows are soft-deleted, plus the optional cleanup SQL from architecture.md §9.

### Done means
- [ ] Every [QA] criterion in spec.md has a result backed by evidence, **including AC-17.1–19.5 (v1.1) and AC-19.6/AC-20.1–20.2/AC-21.1–21.8 (v1.2)**. None are left untested.
- [ ] Every design.md §6 state has a screenshot, and the minimum screenshot set exists (**including the v1.1 and v1.2 additions above**).
- [ ] axe results are recorded and there are no serious or critical violations (or they're filed as FAIL), **checked on at least one non-Pumo pet's home screen too, not only Pumo's**.
- [ ] `tests/qa-report.md` is committed, with the DATHAN checklist included (**including AC-17.8, sticker programming for Zuumi and Banh Mi** — v1.2 adds nothing to this checklist).
- [ ] No live `QA-test` rows remain, for any of the 3 pets.
- [ ] The CSV export was actually downloaded once during testing and its contents checked against the known seeded rows (right header, right row count, right values) — not just that the button didn't error.
- [ ] **v1.2:** at least one full edit-time cycle was verified end to end against the real database (open editor → change time → Save → confirm the row, counter, day-grouping and heatmap all updated), on both home and history, for at least one non-default pet. The DB-level future-time rejection (`23514`) was confirmed via a direct REST call, not only through the UI.

---

## 3. Fix loop and final hand-off

1. For every FAIL, QA sends the defect section to the frontend agent. The frontend agent fixes it, bumps `build.txt`, redeploys and confirms LIVE_URL serves the new build.
2. QA re-tests each failed criterion, plus this smoke set: AC-3.1, AC-4.1, AC-7.1, AC-7.2, AC-8.3, AC-9.2, AC-10.3, AC-12.1, AC-13.1. It updates the report and adds `-after-fix` screenshots.
3. Repeat at most 3 rounds. Anything still failing gets listed plainly as a known issue, with its impact.
4. The final message to Dathan contains:
   - LIVE_URL
   - PASS/FAIL counts, with any known issues or BLOCKED items and their exact next steps (including "merge PR #n" if the deploy fallback was used)
   - A reminder that programming the sticker (architecture.md §7 step 9) and the DATHAN checklist in `tests/qa-report.md` are the only steps left.
