# Pumo Feed Log: build tasks

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
- Owns outright: the [UNIT] parts of AC-7.3 and AC-8.5

### Task 1: Supabase setup and preflight (config, not code)
1. Write `backend/schema.sql` exactly as in `contract.md` §2.
2. Read the setup values in `docs/architecture.md` §8.
   - **`SUPABASE_SETUP_PATH = mcp`:** use the Supabase MCP tools:
     1. `list_organizations`
     2. `get_cost` then `confirm_cost` (must be $0, Free plan)
     3. `create_project` (name `pumo-feed-log`, region `SUPABASE_REGION` or `us-west-1`)
     4. Poll `get_project` until the status is healthy or active
     5. `apply_migration` (name `create_feeds`, SQL = `backend/schema.sql`)
     6. `get_project_url` and `get_publishable_keys` (prefer the `sb_publishable_…` key)
     7. Write the URL and key into §8 and `frontend/js/config.js`
   - **If a free project already exists** in the org with the name `pumo-feed-log`, reuse it and apply the migration instead of creating a second one.
   - **`manual`:** copy `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` into `frontend/js/config.js`.
3. **Preflight.** Run these with `curl` and paste the status codes and response bodies into the hand-off:
   1. GET "last 3" (contract §6.A) → `200` with a JSON array.
   2. POST `{"id":"<new uuid>","logged_by":"Build-test"}` → `201` with the row, including a server `created_at`.
   3. POST the **same** id again → `409`, code `23505`.
   4. POST with `created_at` (contract §6.F) → `401`/`403`, code `42501`.
   5. PATCH soft-delete on the row from 3.2 → `200` with `deleted_at` set. Repeating it → `200 []`.
   6. DELETE on that row → `401`/`403`, code `42501`. A GET by id still returns it.
4. **If the preflight fails:**
   - **MCP path:** re-apply `backend/schema.sql` with `execute_sql`, run `notify pgrst, 'reload schema';`, and retry once.
   - **Manual path:** wait 60 s and retry once.
   - **Still failing:** stop the build and report **BLOCKED**, naming the exact failing call. The fix to give Dathan is "re-run architecture.md §7 step 2 SQL in the SQL Editor". If `*.supabase.co` can't be reached from the build environment at all, report BLOCKED: network allowlist (architecture.md §7 step 7.5).

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
3. **`js/constants.js`:** exactly contract.md §7.1. **`js/config.js`:** per contract.md §4. Set `PUMO_PHOTO_URL = 'assets/pumo.jpg'` only if `PUMO_PHOTO` is set in the setup values.
4. **`js/logic.js`:** every function listed in architecture.md §4, following contract.md §7 to the letter. `now` is always a parameter.
5. **`js/api.js`:** the four operations and error normalization from contract.md §6 and §8. It must never send `created_at` and never use `DELETE`.
6. **`js/storage.js`:** contract.md §9, with every access wrapped in try/catch.
7. **`js/ui.js`:**
   - The status region.
   - `onFocusRefresh`: `visibilitychange`→visible, `focus`, and `pageshow`, debounced.
   - The shared feed row with inline delete confirmation (design.md §3.6), its focus handling and Escape.
   - Error panel and refresh banner.
8. **`js/home.js`**
   - The button state machine exactly as in architecture.md §4, with the 6 s arm timeout and the revert on hide.
   - The 30 s tick: relative labels, ready/guarded, and midnight detection → refresh.
   - The undo notice (design.md §3.5).
   - The name card and footer (design.md §3.7).
   - All the states in design.md §6 (S1–S8, S13, S14).
9. **`js/history.js`:** day groups with counts, paging with "Show older feeds", delete confirmation, a focus refresh that reloads the first page and drops the older pages, and states S9–S13.
10. **Self-review checks:**
    - `grep` finds no `innerHTML` assignments that include feed or name data.
    - No `'DELETE'` string anywhere in `frontend/js`.
    - No `created_at` in any request body.
    - No number literals that duplicate constants.

### Task 3: Unit tests (`tests/unit/logic.test.mjs`, run with `node --test tests/unit`)
The suite must pass with both `TZ=America/Los_Angeles` and `TZ=UTC`. Cover at least:
- **`guardState`:**
  - Elapsed 1h 59m 59s → recent; exactly 2h 00m 00s → not recent.
  - todayCount 3 → not daily; 4 → daily.
  - Both at once, and no feeds at all.
  - Negative elapsed (clock skew) counts as 0.
- **`armedLabel`:** all three variants, word for word as in contract.md §7.2.
- **`formatRelative`:** 0 s, 59 s, 60 s, 59 m, 60 m ("1h 0m ago"), 23h 59m, 24 h ("1d 0h ago").
- **`startOfLocalDay`:** a normal day, 2026-03-08 and 2026-11-01 in `America/Los_Angeles`, and a feed at 23:59:59.999 vs 00:00:00.000.
- **`groupByDay`:** feeds on both sides of midnight, ordering, counts.
- **`deleteConsequence`:** every case and example in contract.md §7.5.
- **`sanitizeName`:** trimming, collapsing whitespace, 20-character cut, empty → `null`, HTML-looking input kept as literal text.
- **`newFeedId`:** a v4 UUID format with and without `crypto.randomUUID` available.

### Task 4: Assets (design.md §8)
- Hand-write `frontend/assets/icon.svg`.
- Generate `apple-touch-icon.png` (180×180, opaque) and `favicon-32.png` from it. Use whichever is available: Playwright/Chromium screenshot, `rsvg-convert`, ImageMagick, or Python PIL with cairosvg.
- If `docs/assets/icon.png` exists, generate both PNGs from it instead, keeping `icon.svg` as the favicon and avatar fallback.
- If `docs/assets/pumo.jpg` exists: center-crop to a square, resize to 256×256, **strip EXIF**, keep it under 100 KB, and save to `frontend/assets/pumo.jpg`.

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
- [ ] `backend/schema.sql` is byte-identical to the SQL in contract.md §2, and all 6 preflight calls returned the expected codes (outputs in the hand-off).
- [ ] `node --test tests/unit` passes under `TZ=America/Los_Angeles` and `TZ=UTC`.
- [ ] `LIVE_URL/build.txt` (or the agreed fallback URL) matches the final commit.
- [ ] In two separate Playwright browser contexts at 390×844: tapping Log a feed in context A shows "Logged" within 1 s, and reloading context B shows the feed at the top of Recent.
- [ ] A feed 1h 55m old (browser clock moved forward) arms on the first tap. One 2h 05m old logs on the first tap.
- [ ] Home and history load with zero console errors, in light and dark.
- [ ] The Task 2 step 10 grep checks are clean.
- [ ] No `Build-test` rows remain undeleted.
- [ ] The hand-off to QA includes: LIVE_URL (or fallback URL), build.txt value, preflight outputs, and Build notes (any judgment calls made).

---

## 2. QA agent

### Goal
Independently prove, on the real Supabase project and the real deploy, that every [QA] criterion in spec.md passes, that every state in design.md §6 looks as specified, and record the evidence.

### Owns
`tests/e2e/`, `tests/screenshots/`, `tests/qa-report.md`. It **does not edit** `frontend/` or `backend/`. Defects go back to the frontend agent.

### Responsible for
Verifying every **[QA]** criterion in spec.md (AC-1.3 through AC-16.6), reviewing that the **[UNIT]** tests exist and pass, and writing the **[DATHAN]** checklist.

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
  - **Before each scenario**, soft-delete every live `QA-test` row with a REST PATCH, so counts and guards start clean.
  - For S1 and S10 (zero feeds): if live rows exist that aren't test rows, don't touch them. Intercept the GETs to return `[]` instead, and note that in the report.
  - For AC-12.3, create 101 `QA-test` rows by REST POST, then soft-delete them.

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
  - Desktop at 1440 px, and 375×553 showing AC-2.3

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
- [ ] Every [QA] criterion in spec.md has a result backed by evidence. None are left untested.
- [ ] Every design.md §6 state has a screenshot, and the minimum screenshot set exists.
- [ ] axe results are recorded and there are no serious or critical violations (or they're filed as FAIL).
- [ ] `tests/qa-report.md` is committed, with the DATHAN checklist included.
- [ ] No live `QA-test` rows remain.

---

## 3. Fix loop and final hand-off

1. For every FAIL, QA sends the defect section to the frontend agent. The frontend agent fixes it, bumps `build.txt`, redeploys and confirms LIVE_URL serves the new build.
2. QA re-tests each failed criterion, plus this smoke set: AC-3.1, AC-4.1, AC-7.1, AC-7.2, AC-8.3, AC-9.2, AC-10.3, AC-12.1, AC-13.1. It updates the report and adds `-after-fix` screenshots.
3. Repeat at most 3 rounds. Anything still failing gets listed plainly as a known issue, with its impact.
4. The final message to Dathan contains:
   - LIVE_URL
   - PASS/FAIL counts, with any known issues or BLOCKED items and their exact next steps (including "merge PR #n" if the deploy fallback was used)
   - A reminder that programming the sticker (architecture.md §7 step 9) and the DATHAN checklist in `tests/qa-report.md` are the only steps left.
