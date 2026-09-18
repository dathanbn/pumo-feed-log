# Pumo Feed Log — QA report

**Status: v1.3 verification pass (added below in §2b/§3's new F22 section/§8d) — a small polish
patch (F22: CSV button icon-only + inline with the legend, newest-first CSV export, re-cropped
Zuumi/Banh Mi photos, slightly larger picker avatars), built and verified by the PM directly
rather than through a dispatched Frontend/QA agent pair (see tasks.md's v1.3 addendum for why).
This is a delta round, not a full re-run like every pass below it: F22 touches only the heatmap
card's header DOM/CSS, `feedsToCsv`'s row order, and the two photo assets/avatar CSS, so only
those code paths and their existing test coverage were re-verified — the 97 pre-existing v1.2
ACs were not individually re-run this round (nothing in F22 touches their code paths; §8d says
exactly what was and wasn't re-checked). Everything below this point (§0 History through §9) is
the unmodified v1.2 report, kept for history.**

**Status: v1.2 verification pass, corrected round** — this pass covers the 3 v1.2 features on
top of the shipped v1.1 build: **F19's AC-19.6** (Download CSV button moved into the heatmap
card's header, restyled subtle), **F20** (real photos for Zuumi and Banh Mi — pure data
change), and **F21** (an inline "edit a feed's logged time" flow, new Edit icon next to each
row's Delete icon). `frontend/` served locally; the v1.1 `mobile-light` re-run plus the
new/extended v1.2 specs (`19-csv-export.spec.js`, `20-pet-photos.spec.js`,
`21-edit-time.spec.js`, plus a rewritten `00-rest-direct.spec.js` AC-5.2b/new
AC-5.2c/AC-21.8a/b) were all run against this pass's build, plus `tests/unit/logic.test.mjs`
(79/79, up from 71/71 — 8 new `computeEditedTimestamp` cases) in both `America/Los_Angeles` and
`UTC`.

**This report was corrected after an Opus review caught two problems with its first draft** —
both are fixed below, not just noted:
1. **D2 (the v1.1 viewport-overflow FAIL) was stale evidence, not a live re-test.** The first
   draft carried forward v1.1's old FAIL verdict and old measurements (`.row` described as
   `min-height: 44px`/`padding: 12px 16px`, 68–69px rows, 14.09px overflow) without actually
   re-running `AC-2.3a` against this pass's build — which already has a completely different,
   already-fixed layout (`min-height: 56px`/`padding: 6px 12px`). Actually re-run this round:
   **AC-2.3a genuinely passes now**, with real margin (see §4's updated D2 entry for the fresh
   measurements). **D2 is closed. The FAIL count for this report is now 0.**
2. **AC-21.5's fixtures used artificially clean (whole-minute, zero-second) `created_at`
   values**, which masked a real bug: a real Supabase `created_at` always carries
   seconds/microseconds, and the "unchanged" check available at the time compared full
   ms-exact timestamps against an `<input type="time">` value that can only ever express
   HH:MM — so tapping Save with nothing user-visibly changed could still fire a PATCH and
   silently rewind the feed's seconds to `:00`. The Frontend agent has since fixed this (a new
   minute-granularity no-op guard in `ui.js`'s `confirmEdit`, ahead of the ms-exact check).
   This report's fixtures were rebuilt with realistic non-zero seconds throughout
   `21-edit-time.spec.js` (a `realisticFeedIso()` helper), and the fix is now genuinely
   exercised and confirmed working — see AC-21.5's row in §3 and the new **D7** entry in §4.

**Also verified this round**: the CSV-export failure message's spacing fix (`#csv-error`,
`frontend/css/styles.css`) looks correct — screenshot re-captured, see §4/screenshots. The
Frontend agent's D6 app-side timing guard (`EDIT_DELETED_MESSAGE_DELAY_MS`, 1200ms, in both
`home.js` and `history.js`) is confirmed to genuinely fix the race documented below — re-run
5/5 clean even with the QA-side mock workaround removed. **D6 is now fixed, not just
documented as a low-severity finding.**

**Bottom line (corrected): all 11 new v1.2 [QA] acceptance criteria pass, D2 (carried over from
v1.1) is confirmed fixed and closed, and D6 (found during this pass) is confirmed fixed by the
Frontend agent. This report now has zero open FAILs.** See §2 for updated counts and §4 for
full detail on D2, D6 and the new D7.

## 0. History

- **Scaffolding pass**: initial dry-run before the frontend build existed.
- **v1.1 real QA pass**: first full run against the real build. Found defects D1–D4 (see below)
  plus a documentation-drift issue (withdrawn "D5" — design.md §2 was stale, not the CSS).
- **Fix round 1** (Opus review of the QA pass + suite itself): fixed 7 QA-side test bugs, moved
  several BLOCKED rows to PASS via new mocked counterpart tests, corrected AC-16.2 (D5
  withdrawn), and re-measured AC-18.3's contrast claim properly. Frontend's D1–D4 fixes were
  still pending confirmation at the end of that round — §2's summary counts were deliberately
  left unreconciled pending this final pass.
- **v1.1 final verification pass**: Frontend reported all 4 defects + the day-heading bug
  fixed. Independently re-verified every claim, re-ran the full suite (not just the
  previously-failing items — a shared-file change can affect more than what's explicitly
  listed), re-captured every stale/missing screenshot, found and fixed 2 more QA-side test
  bugs (a race condition and a missing mock, both documented in §4), added one permanent
  regression test that didn't exist before, and reconciled §2's counts for real. **Net result:
  found that D2 is not actually fully fixed** — see §4. (§8's "v1.1 pass" subsection and the
  "v1.1 screenshot inventory" subsection below still describe that pass's own numbers verbatim;
  v1.2's numbers are called out explicitly wherever they differ.)
- **v1.2 pass, first draft**: verified the 3 v1.2 features (F19's AC-19.6, F20, F21) against a
  Frontend build on top of that same v1.1 base. Extended `tests/e2e/` with a new
  `21-edit-time.spec.js` (17 tests) and a new `20-pet-photos.spec.js` (6 tests), extended
  `19-csv-export.spec.js` (+4 tests for AC-19.6) and `00-rest-direct.spec.js` (rewrote the now-
  stale AC-5.2b, added AC-5.2c/AC-21.8a/AC-21.8b), and re-ran every pre-existing spec that
  touches a row or the heatmap card to check for v1.2 regressions. Found and fixed 6 QA-side
  test bugs while building this suite (locator scoping/indexing bugs in the new spec, a route-
  registration race in `19-csv-export.spec.js`, a stale assertion, a real-network test hang, a
  fixture conflict — all listed in §4) and no frontend regressions. Found one new, low-severity
  timing race (D6, §4) — not present in v1.1, specific to F21's new "target deleted concurrently"
  path. **This draft carried forward v1.1's stale D2 FAIL without re-testing it, and used
  artificially clean (whole-minute) `created_at` fixtures in `21-edit-time.spec.js` that masked
  a real no-op-Save rewind bug — both caught by an Opus review, see the next entry.**
- **v1.2 pass, corrected round (this report)**: per the Opus review's two findings, actually
  re-ran `AC-2.3a` against the current build (D2 is genuinely fixed — closed, see §4) with
  fresh measurements, rebuilt every `21-edit-time.spec.js` fixture with realistic non-zero-
  second `created_at` values (a new `realisticFeedIso()` helper) and re-verified the whole file
  (17/17, stable across repeated runs), and confirmed two Frontend fixes that landed in the
  meantime: the D6 background-refresh race (now fixed app-side via
  `EDIT_DELETED_MESSAGE_DELAY_MS`, re-confirmed 5/5 stable with the QA-side mock workaround
  removed) and the AC-21.5 no-op-Save rewind bug (now fixed via a minute-granularity guard in
  `ui.js`, re-confirmed with realistic fixtures — new **D7**, marked fixed). Net result: **the
  FAIL count drops from 1 to 0.**

## 1. Header

| Field | Value |
|---|---|
| Tested URL | `http://127.0.0.1:8080` (`frontend/` served locally via `python3 -m http.server`) — this sandbox's network egress does not reach the real `LIVE_URL` deploy or `*.supabase.co` over plain HTTP(S) (confirmed directly: `curl` to the Supabase host gets `403` from the sandbox's egress proxy, and a real Chromium `fetch()` to the same host fails in ~235ms with `TypeError: Failed to fetch`, not a hang), so the served static files are byte-identical to what would deploy but no live-deploy/live-Supabase round trip was exercised end-to-end from here (see BLOCKED rows below and Dathan's checklist, §6). Direct SQL against the live Supabase project **is** reachable, via the Supabase MCP connector (server-side, not subject to the sandbox's HTTP egress policy) — used for AC-5.2/11.1/11.2 and test-data cleanup confirmation. |
| LIVE_URL (architecture.md §8) | `https://dathanbn.github.io/pumo-feed-log/` — not reachable from this sandbox this pass |
| `build.txt` | v1.2 build served by Frontend for this pass (`frontend/` served locally via `python3 -m http.server`) |
| Date / time of this pass | 2026-09-18 (v1.2 pass) |
| Supabase project ref | `dufyzxtrhdcwrebagsfs`, region `us-east-2` — v1.2 DB changes confirmed via direct SQL this pass: `feeds.created_at` UPDATE grant widened for `anon`, and a new `feeds_created_at_not_future` CHECK constraint (`created_at <= now() + interval '5 minutes'`) exists exactly as contract.md documents; `pets.photo_url` is set for all 3 rows (Pumo/Zuumi/Banh Mi). |
| Browsers / devices | Chromium via Playwright (`tests/e2e/playwright.config.js`): `mobile-light`/`mobile-dark` (iPhone 13, 390×844), `desktop-light` (1440×900), plus in-test viewport overrides (375×553, 390×664) |
| Time zone | `America/Los_Angeles` (primary, all Playwright runs); unit tests also re-run under `UTC` |
| Unit tests | **79/79 pass** under both `TZ=America/Los_Angeles` and `TZ=UTC` (`node --test tests/unit/logic.test.mjs`) — up from 71/71 in the v1.1 pass; the 8 new cases are `computeEditedTimestamp` (contract.md §7.11: DST-transition days, the grace window, the unchanged case, invalid formats). Note: `node --test tests/unit` (bare directory) does not work in this sandbox's Node (`MODULE_NOT_FOUND`) — use the explicit file path shown above; this is a pre-existing environment quirk, not a defect. |
| Console errors | Zero new console errors observed in the v1.2 mocked spec runs (`21-edit-time.spec.js`, `20-pet-photos.spec.js`, `19-csv-export.spec.js`'s new AC-19.6 tests); not independently re-swept across all pets/schemes this pass (that was the v1.1 pass's own check, unaffected by a pure data change (F20) and additive UI (F19/F21) — see §8). |

## 2. Summary counts

Counted at AC granularity. v1.1's base was 86 ACs (F1–F19, including AC-19.5). **v1.2 adds 11
new [QA] ACs** (AC-19.6, AC-20.1, AC-20.2, AC-21.1 through AC-21.8), independently confirmed by
diffing every `AC-\d+\.\d+ [QA]` token in spec.md's v1.2 sections against every new AC row in
§3 below — exact 1:1 match. **Total: 97.** Unlike this report's first draft, **AC-2.3 (D2) was
actually re-run this round** (not carried forward from v1.1 unverified) and now passes — see
§4. The other 85 v1.1 rows are carried forward unchanged from the prior (final) v1.1 pass;
F19/F20/F21 don't touch any of their own code paths except AC-19.5's button (AC-19.6b
explicitly re-confirms its behavior is unchanged by the restyle/move) and AC-2.3's `.row`/
`.page` layout (which F21's second icon button does touch, hence the re-test).

| Result | Count | Meaning |
|---|---|---|
| PASS | 67 | 55 carried forward from the v1.1 final pass, **+11 new this pass** (every one of v1.2's 11 [QA] ACs), **+1 corrected this round**: AC-2.3, re-run for real against the current build (D2 is fixed — see §4), moves FAIL→PASS. AC-21.8 is "PASS via direct SQL" (same pattern as AC-5.2) since the network-blocked sandbox can't run it through Playwright directly. |
| FAIL | 0 | None. AC-2.3 (D2) was the only FAIL in the prior draft of this report and is now confirmed fixed — see §4 for the fresh measurements. |
| BLOCKED | 26 | Carried forward from v1.1 — sandbox network egress does not reach `*.supabase.co` over HTTP(S). Unchanged; v1.2 adds no new BLOCKED rows (every new v1.2 [QA] AC was fully resolvable via mocked Playwright tests, source checks, and/or direct SQL-as-`anon` — see §1's Tested-URL row and the evidence file `tests/e2e/evidence/ac-21.4-21.8-sql-verification.json`). |
| INCONCLUSIVE (environment) | 1 | AC-18.1 — carried forward from v1.1, unchanged. |
| DATHAN (not QA's to run) | 3 | AC-1.1, AC-1.2, AC-17.8 — carried forward from v1.1. v1.2 adds none (F20/F21 are fully verifiable by QA — no real-phone-only step, per tasks.md). |
| **Total** | **97** | 86 (v1.1) + 11 (v1.2). |

## 2b. v1.3 delta (F22) — added this round, not part of the v1.2 pass above

**F22 adds 4 new [QA] ACs** (AC-22.1 through AC-22.4, spec.md). All 4 PASS. New total: **101**
(97 + 4); PASS: **71** (67 + 4); every other row in §2's table is unchanged (this round adds no
new BLOCKED, FAIL, INCONCLUSIVE or DATHAN rows).

| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-22.1 | PASS | `19-csv-export.spec.js` `AC-19.6a / AC-22.1` (mocked), `AC-19.6b/c/d` (mocked) | CSV button confirmed icon-only (`toHaveText('')`, aria-label carries the full name), a descendant of `.heatmap__header` alongside `#heatmap-legend` (legend `x` < button `x`, button flush to the header's right edge), styled `.btn--text.btn--icon-only`, 44×44 tap target preserved. Busy state (spinner icon swap, disabled) and hide/show-with-card behavior unchanged. |
| AC-22.2 | PASS | `19-csv-export.spec.js` `AC-19.3c` (fixture) + ad hoc real-download check (not shipped, run once during this pass) | `feedsToCsvExpected`'s own reimplementation confirms newest-first row order against a 2-feed fixture; a one-off Playwright script clicking the real button and parsing the real downloaded file independently confirmed the same order end to end (`['Newer', 'Older']`). `tests/unit/logic.test.mjs`'s `feedsToCsv` suite also updated and passing (79/79 total). |
| AC-22.3 | PASS | Visual review of `frontend/assets/zuumi.jpg`/`banh-mi.jpg` after re-crop; `20-pet-photos.spec.js` AC-20.1a/b/c/d re-run (mocked) | Both photos re-generated with the nose vertically centered (crop math documented in the re-crop script), ears visible at the top of frame — compared side by side against the pre-v1.3 crop and against `pumo.jpg`'s existing framing for consistency. No `photo_url` or filename change, so no code path beyond the asset bytes themselves was touched. |
| AC-22.4 | PASS | `02-home-headline.spec.js` `AC-2.3a`/`AC-2.3b` re-run (mocked, local static server) | Avatar CSS bumped 28px→32px (unselected) / 32px→36px (selected). Re-ran the exact AC-2.3a/b fit assertions (every named element's bounding box within the 375×553 / 390×664 viewports, no scroll) against the new sizing — both still pass with no changes needed elsewhere in the layout. Tap target unchanged (was already 44×44). |

## 3. Results table

`AC | Result | Evidence | Notes`

Only rows that changed this pass are called out with **"[this pass]"** in Notes; everything
else was re-run and reproduces fix round 1's result unchanged (see §0 — this was a full re-run,
not a delta run, precisely so a shared-file regression elsewhere wouldn't be missed).

### F1. NFC tag opens the app
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-1.1 | DATHAN | — | Physical sticker check; see §6. |
| AC-1.2 | DATHAN | — | Physical tap-test on 4 household phones; see §6. |
| AC-1.3 | **PASS** | `specs/01-app-load.spec.js` AC-1.3a (skips itself — LIVE_URL isn't https:// in this sandbox), AC-1.3b (**PASS**) | Deploy serves over HTTP(S) with no gate; `build.txt` matches. AC-1.3a itself needs the real HTTPS deploy. |

### F2. Home screen: last-fed headline and last 3 feeds
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-2.1 | **PASS** | `02-home-headline.spec.js` AC-2.1a/b | |
| AC-2.2 | **PASS** | `02-home-headline.spec.js` AC-2.2a/b | |
| AC-2.3 | **PASS** | `02-home-headline.spec.js` AC-2.3a (**PASS**), AC-2.3b (**PASS**) | **[v1.2 corrected round]** D2 re-run for real against the current build (an earlier draft of this report had carried forward v1.1's stale FAIL/measurements without re-testing — caught by review) — genuinely fixed. See §4 for fresh measurements and the corrected-round note. |
| AC-2.4 | **PASS** | `02-home-headline.spec.js` AC-2.4 | |
| AC-2.5 | BLOCKED | `02-home-headline.spec.js` AC-2.5a (PASS — server-side filter param proven), AC-2.5b (BLOCKED — real network) | The server-side query shape is right; the full end-to-end proof (delete a real feed, reload, confirm gone) needs real Supabase reach. |

### F3. One-tap logging
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-3.1 | BLOCKED | `03-logging.spec.js` AC-3.1 | Real network (real POST to `/rest/v1/feeds`). Confirmed this pass: the app correctly shows "Not saved, tap to retry" within ~1s once the real POST fails fast (not a 45s hang) — the failure-handling path itself is working as designed. |
| AC-3.2 | BLOCKED | `03-logging.spec.js` AC-3.2 | Same. |

### F4. Button locks while saving; failed saves can be retried
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-4.1 | **PASS** | `04-button-lock-retry.spec.js` AC-4.1 (BLOCKED, real network), AC-4.1b (**PASS**, mocked) | 5 rapid taps while disabled send exactly 1 POST — mocked, confirmed. |
| AC-4.2 | **PASS** | `04-button-lock-retry.spec.js` AC-4.2 (BLOCKED, real network), AC-4.2b (**PASS**, mocked) | "Logged" never shown before the mocked 201 resolves. |
| AC-4.3 | BLOCKED | `04-button-lock-retry.spec.js` AC-4.3a/b/c (BLOCKED, real network), AC-4.3d (**PASS** — pure client-side timeout) | |
| AC-4.4 | **PASS** | `04-button-lock-retry.spec.js` AC-4.4 (BLOCKED, real network), AC-4.4b (**PASS**, mocked) | The 409/`23505` lost-response-then-retry path mocked end to end — confirmed the retry reuses the same id. |
| AC-4.5 | BLOCKED | `04-button-lock-retry.spec.js` AC-4.5 | Real network. |

### F5. The server sets the timestamp
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-5.1 | BLOCKED | `05-server-timestamp.spec.js` AC-5.1 | Real network. |
| AC-5.2 | **PASS** (via direct SQL, not Playwright) — **v1.2 note below** | Re-verified directly against the live Supabase project this pass, via the Supabase MCP connector, `SET ROLE anon`-equivalent scoping: an `INSERT ... created_at=...` as `anon` is rejected (`insufficient_privilege`), matching contract.md's "Calls that must fail" table. `specs/00-rest-direct.spec.js` AC-5.2a itself reports BLOCKED (Node-side `403` before even reaching Supabase) — the SQL check is the real verdict here. **v1.2 doc-drift note**: spec.md's AC-5.2 prose is unchanged from v1.1 and still describes an `UPDATE ... created_at=...` as `anon` as always-rejected — that's now stale. contract.md's v1.2 change (the whole point of F21) widens the `created_at` UPDATE grant so a past/near-future value succeeds and only a far-future one is rejected (`23514`, not a grant error). Per this project's own rule ("where files seem to disagree: contract.md wins on data..."), contract.md's version is authoritative and is what F21/AC-21.3/AC-21.4/AC-21.8 were verified against. This is a **documentation-only issue** in spec.md, not a frontend or backend defect — flagging for whoever next edits spec.md to reword AC-5.2 to scope its "no `created_at` UPDATE" claim to INSERT only, or to explicitly note the v1.2 carve-out. |

### F6. Data reloads on page load and on focus
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-6.1 | BLOCKED | `06-refresh-focus.spec.js` AC-6.1 | Real network — 0 GETs observed because the browser-side request to the blocked host fails immediately client-side (confirmed: ~235ms `TypeError: Failed to fetch`, not a caching bug). |
| AC-6.2 | BLOCKED | `06-refresh-focus.spec.js` AC-6.2; also on Dathan's checklist (§6) | Real network (device A's real page load). |
| AC-6.3 | **PASS** | `06-refresh-focus.spec.js` AC-6.3 | Fully mocked — stale-data refetch ("Checking…") confirmed. |
| AC-6.4 | **PASS** | `06-refresh-focus.spec.js` AC-6.4 | |

### F7. Recent-feed guard (2 hours)
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-7.1 | BLOCKED | `07-recent-guard.spec.js` AC-7.1 | Real network — confirming tap correctly shows "Not saved, tap to retry" once the real POST fails. |
| AC-7.2 | BLOCKED | `07-recent-guard.spec.js` AC-7.2 | Same. |
| AC-7.3 | **PASS** (UNIT) | `tests/unit/logic.test.mjs` | Pure `guardState` math; part of the 71/71 unit pass. |
| AC-7.4 | **PASS** | `07-recent-guard.spec.js` AC-7.4a/b | Arm/revert timing, fully mocked. |
| AC-7.5 | BLOCKED | `07-recent-guard.spec.js` AC-7.5 | Real network. |
| AC-7.6 | BLOCKED | `07-recent-guard.spec.js` AC-7.6 | Real network. |
| AC-7.7 | BLOCKED | `07-recent-guard.spec.js` AC-7.7 | Real network. |
| AC-7.8 | BLOCKED | `07-recent-guard.spec.js` AC-7.8 | Real network. |

### F8. Daily count ("n of 4 today") — 3 AM boundary
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-8.1 | **PASS** | `08-daily-guard.spec.js` AC-8.1a/b | |
| AC-8.2 | **PASS** | `08-daily-guard.spec.js` AC-8.2a/b/c | |
| AC-8.3 | BLOCKED | `08-daily-guard.spec.js` AC-8.3 | Real network. |
| AC-8.4 | BLOCKED | `08-daily-guard.spec.js` AC-8.4 | Real network. |
| AC-8.5 | **PASS** | `08-daily-guard.spec.js` AC-8.5a (3 AM reset), AC-8.5b (12am–3am "Yesterday" label) | Both fully mocked, deterministic. |

### F9. Undo right after logging
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-9.1 | **PASS** | `09-undo.spec.js` AC-9.1 (BLOCKED, real network), AC-9.1b (**PASS**, mocked) | Undo notice shows "Logged {time}" + Undo, lasts UNDO_WINDOW_MS. |
| AC-9.2 | **PASS** | `09-undo.spec.js` AC-9.2 (BLOCKED, real network), AC-9.2b (**PASS**, mocked) | Undo PATCHes the right row; "Feed removed" shown. |
| AC-9.3 | **PASS** | `09-undo.spec.js` AC-9.3 (BLOCKED, real network), AC-9.3b (**PASS**, mocked) | After UNDO_WINDOW_MS, only Delete-with-confirmation remains. |
| AC-9.4 | **PASS** | `09-undo.spec.js` AC-9.4 (BLOCKED, real network), AC-9.4b (**PASS**, mocked) | Failed undo shows "Couldn't undo" with Retry/Dismiss. |
| AC-9.5 | **PASS** | `09-undo.spec.js` AC-9.5 (BLOCKED, real network), AC-9.5b (**PASS**, mocked) | Logging again while the notice shows replaces it. |

### F10. Delete any past feed, with one confirmation
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-10.1 | **PASS** | `10-delete.spec.js` AC-10.1 | **[this pass]** Defect D1 confirmed fixed — moves FAIL→PASS. Delete icon button measured 44×44 in Chromium (was 40×40); re-confirmed on mobile-light, mobile-dark, and desktop-light. |
| AC-10.2 | **PASS** | `10-delete.spec.js` AC-10.2, AC-10.2b | Exact `deleteConsequence` sentence matches; Escape-to-cancel confirmed. |
| AC-10.3 | BLOCKED | `10-delete.spec.js` AC-10.3 | Real network. |
| AC-10.4 | **PASS** | `10-delete.spec.js` AC-10.4 | **[this pass]** Fixed a QA-side race condition in this test (see §4 "Test-suite fixes") that was making it intermittently read as a real-network-blocked failure; now passes reliably (5/5 clean runs across all 3 browser projects after the fix). |
| AC-10.5 | **PASS** | `10-delete.spec.js` AC-10.5 | |

### F11. Soft deletes only
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-11.1 | **PASS** (via direct SQL) | Re-verified directly this pass: a soft-deleted row (anon PATCH `deleted_at`) still exists and is readable, with `deleted_at` set. | |
| AC-11.2 | **PASS** (via direct SQL) | Re-verified directly this pass: `anon` has no `DELETE` grant on `feeds` — a direct SQL delete as `anon` is rejected (`insufficient_privilege`) and the row survives. | |
| AC-11.3 | **PASS** | `11-soft-delete-source.spec.js` AC-11.3 | Pure source grep — no `DELETE` HTTP call anywhere in `frontend/js`. |

### F12. Full history
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-12.1 | **PASS** | `12-history.spec.js` AC-12.1a, AC-12.1b/12.2 | Day grouping (Today/Yesterday/date), newest-first ordering, correct per-day counts. **[this pass]** Additionally independently re-verified the *day-heading date-text* fix (not just the bucketing) with a dedicated repro: a feed at 1:30 AM (feed day = previous calendar date) now renders its non-Today/Yesterday heading as the correct feed-day date ("Monday, September 7"), not the raw calendar date of the timestamp ("Tuesday, September 8") — see §4. |
| AC-12.2 | **PASS** | (same test as above) | |
| AC-12.3 | **PASS** | `12-history.spec.js` AC-12.3 (BLOCKED, real network), AC-12.3b (**PASS**, mocked) | First-100-load / "Show older feeds" merge / button-disappears-once-<100-return, all confirmed via a 2-page mocked fixture. |
| AC-12.4 | BLOCKED | `12-history.spec.js` AC-12.4a (BLOCKED, real network), AC-12.4b (**PASS** — back-link navigation) | |

### F13. Shared backend (Supabase)
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-13.1 | BLOCKED | `13-shared-backend.spec.js` AC-13.1 | Inherently real-network (two browser profiles against the real DB). |
| AC-13.2 | BLOCKED | `13-shared-backend.spec.js` AC-13.2a/b | Same. |

### F14. "by {name}" without logins
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-14.1 | BLOCKED | `14-name.spec.js` AC-14.1 | Real network. |
| AC-14.2 | BLOCKED | `14-name.spec.js` AC-14.2 (BLOCKED, real network); AC-14.2b (**PASS** — name sanitization, pure client-side) | |
| AC-14.3 | BLOCKED | `14-name.spec.js` AC-14.3 | Real network. |
| AC-14.4 | **PASS** | `14-name.spec.js` AC-14.4 | Footer copy variants, reopens the card. |
| AC-14.5 | **PASS** | `14-name.spec.js` AC-14.5 | HTML-looking names render as plain text (XSS-safe). |
| AC-14.6 | BLOCKED | `14-name.spec.js` AC-14.6 | Real network. |

### F15. No access control (intentional)
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-15.1 | BLOCKED | `15-no-access-control.spec.js` AC-15.1 (BLOCKED — needs a real write); AC-15.1b (**PASS** — history reachable with zero stored data, no login) | |

### F16. Look and feel
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-16.1 | **PASS** | `16-look-and-feel.spec.js` AC-16.1 | Header shows the selected pet's name + avatar correctly. |
| AC-16.2 | **PASS** | `16-look-and-feel.spec.js` AC-16.2 | Real shipped `--surface-100` token confirmed against live computed style, both schemes. |
| AC-16.3 | **PASS** | `16-look-and-feel.spec.js` AC-16.3 | 1440×900 stays single-column, ≤440px. |
| AC-16.4 | **PASS** | `16-look-and-feel.spec.js` AC-16.4 | Tab title, favicon, apple-touch-icon. |
| AC-16.5 | **PASS** | `16-look-and-feel.spec.js` AC-16.5a–l (all **PASS**), AC-16.5e (**PASS**, mocked — see §4 test-suite fix), AC-16.5g (BLOCKED — real network, seeds rows), new **D3 regression test** (**PASS**) | **[this pass]** Defect D3 confirmed fixed — moves FAIL→PASS. Exactly one "Try again" control shown after two consecutive load failures, both for the feeds-load-error panel (AC-16.5e) and the pet-load-error panel (the new dedicated D3 regression test — see §4, since no existing test covered that exact panel by name). Every S1–S15 screenshot state is otherwise correct, light+dark where required. |
| AC-16.6 | **PASS** | `16-look-and-feel.spec.js` AC-16.6a (axe, **PASS**), AC-16.6b (axe, **PASS**), AC-16.6c (keyboard, **PASS**), AC-16.6d (**PASS** for the tap-target claim; its own trailing real-network sub-assertion is BLOCKED) | **[this pass]** Defect D1 confirmed fixed — moves FAIL→PASS. Zero axe violations. Directly re-measured: row Delete button 44×44 (was 40×40), Undo button 63.9×44 (both ≥44×44), Log button min-height 64px — all via live Chromium bounding-box reads, independent of the real-network portion of this specific test (which is BLOCKED in this sandbox but isn't what determines the tap-target verdict). |

### F17. Multiple pets (v1.1)
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-17.1 | **PASS** | `17-pets.spec.js` AC-17.1 | No `?pet=` shows Pumo. |
| AC-17.2 | **PASS** | `17-pets.spec.js` AC-17.2a (×2), AC-17.2b | Zuumi/Banh Mi URLs work; unrecognized slug falls back to Pumo. |
| AC-17.3 | **PASS** | `17-pets.spec.js` AC-17.3a/b/c | Picker shows all 3 in `sort_order`, tapping navigates within 1s, screenshot set captured. |
| AC-17.4 | **PASS** | `17-pets.spec.js` AC-17.4 (BLOCKED, real network), AC-17.4b (**PASS**, mocked) | Logging for one pet never changes another's headline/counter/recent list. |
| AC-17.5 | **PASS** | `17-pets.spec.js` AC-17.5 | `history.html?pet=zuumi` scoping + back-link. |
| AC-17.6 | **PASS** | `17-pets.spec.js` AC-17.6 | Zuumi (cat) vs Banh Mi (dog) placeholder avatars visually distinguishable. |
| AC-17.7 | **PASS** | `17-pets.spec.js` AC-17.7 | Source grep: no pet-specific literal in `config.js`; every `feeds` query filters by `pet_id`. |
| AC-17.8 | DATHAN | — | Sticker programming for Zuumi and Banh Mi; see §6. |

### F18. Feeding heatmap on the history screen (v1.1)
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-18.1 | **INCONCLUSIVE** (environment) | `18-heatmap.spec.js` AC-18.1 | **[this pass]** Re-confirmed independently: `page.screenshot()` hangs specifically inside the Playwright test runner in this sandbox (`Target page, context or browser has been closed` after the 45s timeout), while the exact same fixture (35 cells, 5 rows) renders correctly and its screenshot succeeds in 57ms via a raw `playwright-core` script with no test runner involved. Test-infrastructure issue, not a code defect. |
| AC-18.2 | **PASS** | `18-heatmap.spec.js` AC-18.2 | Sun–Sat columns, each cell's date matches a real calendar date. |
| AC-18.3 | **PASS** | `18-heatmap.spec.js` AC-18.3 | 5-tier shading; padding cells render at tier 0. Contrast: adjacent-tier OKLCH ΔL and date-number contrast both re-measured and hold WCAG. |
| AC-18.4 | **PASS** | `18-heatmap.spec.js` AC-18.4 | **[this pass]** Defect D4 confirmed fixed — moves FAIL→PASS. Directly re-verified with the exact zero-feed fixture (`mockHistoryFirstPage(page, [])`): the heatmap now renders unconditionally, today's cell shows its "today" outline at tier 0, and the aria-label reads correctly ("…: no feeds"). |
| AC-18.5 | **PASS** | `18-heatmap.spec.js` AC-18.5a/b/c | Expand/collapse panel works; only one open at a time; zero-feed-cell tap is a documented no-op. |
| AC-18.6 | **PASS** | `18-heatmap.spec.js` AC-18.6, AC-18.6b (axe) | Legend text exact; every cell has a correct accessible name; zero axe violations. |
| AC-18.7 | **PASS** | `18-heatmap.spec.js` AC-18.7 (BLOCKED, real network), AC-18.7b (**PASS**, mocked) | A focus refresh re-fetches and the heatmap reflects a delete within 1s. |

### F19. CSV export of full feed history (v1.1)
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-19.1 | **PASS** | `19-csv-export.spec.js` AC-19.1 (BLOCKED, real network), AC-19.1b (**PASS**, mocked) | Header row, filename pattern, pet-scoping, `\r\n` line endings all confirmed. |
| AC-19.2 | **PASS** | `19-csv-export.spec.js` AC-19.2 (BLOCKED, real network), AC-19.2b (**PASS**, mocked) | Export walks every page via `getAllFeedsForExport`, confirmed with a mocked 2-page (100+5 row) fixture. |
| AC-19.3 | **PASS** | `19-csv-export.spec.js` AC-19.3a (BLOCKED, real network), AC-19.3b (BLOCKED, real network), AC-19.3c (**PASS**), AC-19.3d (**PASS**, mocked) | Comma/quote RFC 4180 round-trip confirmed client-side; "deleted feeds never appear" stays real-network-only by design (a mock can't meaningfully exercise a server-side filter claim). |
| AC-19.4 | BLOCKED | `19-csv-export.spec.js` AC-19.4a (BLOCKED, real network — busy-state check needs a real in-flight export); AC-19.4b (**PASS**) | AC-19.4b confirms the documented judgment call: a mid-export failure shows a persistent inline line (S15) + no partial download. |
| AC-19.5 | **PASS** | `19-csv-export.spec.js` AC-19.5 | Keyboard-reachable; accessible name includes the pet's name. |
| AC-19.6 (v1.2) | **PASS** | `19-csv-export.spec.js` AC-19.6a (DOM position/style), AC-19.6b (busy state unchanged), AC-19.6c (hides/shows WITH the heatmap card), AC-19.6d (screenshot set) — all **PASS** | Button now lives inside `#heatmap-card`'s `.heatmap__header`, top-right, styled `.btn--text` (not the v1.1 `.btn--outline`/full-width style). Busy state (icon→spinner, "Preparing…", disabled), keyboard reachability and accessible name (`"Download {pet}'s feed history as CSV"`) all unchanged by the move, confirmed directly. Screenshots: `19-history-csv-header-{resting,preparing}-{light,dark}.png`. |

### F20. Real photos for Zuumi and Banh Mi (v1.2)
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-20.1 | **PASS** | `20-pet-photos.spec.js` AC-20.1a (×2, selected avatar), AC-20.1b (picker's other avatars), AC-20.1c/d (screenshot set) | Both Zuumi's and Banh Mi's pet-picker avatars (selected and non-selected) now render a real `<img src="assets/{slug}.jpg">`, not the placeholder SVG — confirmed `<svg>` count is 0 in both cases. `alt=""` + `aria-hidden="true"` on the wrapper preserved (design.md §3.0/AC-16.1 pattern). Confirmed directly against the live DB via Supabase MCP: `pets.photo_url` set for all 3 rows. Screenshots: `20-home-pet-picker-real-photos-{light,dark}.png`, `20-home-pet-picker-{zuumi,banh-mi}-real-photo-selected-{light,dark}.png`. |
| AC-20.2 | **PASS** | `20-pet-photos.spec.js` AC-20.2 | Confirmed this is genuinely a data-only change: fed `getPets()` a made-up `photo_url` via a mocked override and the SAME `buildPetAvatar`/`getPets` code renders it verbatim, with no per-slug special-casing anywhere in `frontend/js`. |

### F21. Editing a feed's logged time (v1.2)
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-21.1 | **PASS** | `21-edit-time.spec.js` AC-21.1a (home), AC-21.1b (history) | Every row — home's recent list and history's day-grouped list alike — shows an Edit icon next to Delete, visible in the row's normal state. |
| AC-21.2 | **PASS** | `21-edit-time.spec.js` AC-21.2a (pre-fill/Save/Cancel/focus), AC-21.2b (shared "one open row at a time" rule with delete-confirm, AC-10.5) | Tapping Edit opens a native `<input type="time">` pre-filled with the feed's current local time (e.g. `07:42`), focus moves to it, Save/Cancel both present. Opening Edit on one row closes another row's open Edit *or* Delete-confirm, and vice versa — confirmed both directions. Screenshots: `21-{home,history}-edit-open-light.png`. |
| AC-21.3 | **PASS** | `21-edit-time.spec.js` AC-21.3a (home: row + headline + PATCH body), AC-21.3b (history: 2:50 AM→3:10 AM crosses the feed-day boundary, day-grouping + heatmap both update) | PATCH body is exactly `{created_at: <same-date, new-time ISO>}`, filtered by `id=eq.{id}&deleted_at=is.null`. The 2:50→3:10 AM case deliberately moves the feed's feed-day (contract.md §7.11's own worked example, not a bug) — confirmed the day heading, the list, and the heatmap's two affected cells all update within the same render, no special-case code. |
| AC-21.4 | **PASS** | `21-edit-time.spec.js` AC-21.4a (home, screenshot), AC-21.4b (history, screenshot), AC-21.4c (grace-window acceptance) | A time >5 min in the future is rejected inline ("Can't set a future time."), editor stays open, confirmed **zero** PATCH requests ever sent (counted directly, not just "no error shown"). A time within `EDIT_FUTURE_GRACE_MS` (5 min) is accepted. Screenshots: `21-{home,history}-edit-future-rejected-light.png`. |
| AC-21.5 | **PASS** (see D7 — fixture corrected, real bug found and fixed) | `21-edit-time.spec.js` AC-21.5a (unchanged-time no-op), AC-21.5b (Cancel), AC-21.5c (Escape) | Save with the time unchanged closes the editor with **zero** network calls (counted directly). Cancel and Escape both discard the edit and return the row to normal, matching delete's own Cancel/Escape pattern. **[v1.2 corrected round]** AC-21.5a's fixture originally used a whole-minute (zero-second) `created_at`, which can't fail this check even with a real ms-exact-comparison bug underneath — masked a genuine no-op-Save rewind bug (see **D7**, §4). Fixture rebuilt with a realistic non-zero-second `created_at` (`realisticFeedIso()`); re-run against the Frontend agent's fix and confirmed passing for real. |
| AC-21.6 | **PASS** (see D6) | `21-edit-time.spec.js` AC-21.6a (network-failure retry), AC-21.6b (home: target deleted concurrently), AC-21.6c (history: same) | A failed Save shows the edit-failed state (`.row--confirm`, mirroring delete-failed) with Retry/Cancel; Retry resends the same idempotent PATCH and succeeds. A concurrently-deleted target shows "This feed was deleted." (confirmed it actually appears, not just that the row eventually disappears) and the row is later dropped by the caller's own background refresh, not a synchronous re-render — matching the Frontend agent's documented design intent. **New low-severity finding**: this "visible window" is not deadline-guaranteed — see **D6** below. |
| AC-21.7 | **PASS** | `21-edit-time.spec.js` AC-21.7 | Edit and Delete are each a real `<button>` with distinct accessible names (`"Edit feed from …, by …"` / `"Delete feed from …, by …"`), both ≥44×44, adjacent in tab order, row still ≥56px tall at 375×553. |
| AC-21.8 | **PASS** (via direct SQL, not Playwright) | `21-edit-time.spec.js` AC-21.8c (source check — **PASS**); `00-rest-direct.spec.js` AC-21.8a/AC-21.8b (BLOCKED — sandbox network); confirmed instead via Supabase MCP direct SQL (`set role anon`) — see `tests/e2e/evidence/ac-21.4-21.8-sql-verification.json` | `updateFeedTime`'s PATCH body only ever contains `created_at` (grepped `api.js`, confirmed no `pet_id`/`logged_by` ever sent). Directly against the live DB as `anon`: a `pet_id` PATCH → `42501`; a `logged_by` PATCH → `42501`; a future `created_at` (>5 min ahead) PATCH → `23514` (the new `feeds_created_at_not_future` CHECK); a past/near-future `created_at` PATCH → success (this is the v1.2 contract change — see the note on AC-5.2's row, F5 section above). |

## 4. Defects

### Fixed and confirmed this round — D2: 375×553 viewport (iPhone SE, Safari toolbars) overflow
- **Status correction**: an earlier draft of this report carried forward v1.1's FAIL verdict
  and measurements for D2 *without actually re-running `AC-2.3a`* against this pass's build —
  caught by an Opus review, which pointed out that the described CSS (`.row` at
  `min-height: 44px`/`padding: 12px 16px`, 68–69px rows) doesn't match the current source at
  all, and that this pass's own `16-home-viewport-375x553-light.png` screenshot (showing the
  new pencil/Edit icon) already visibly showed the Log button fitting with room to spare. This
  entry replaces that stale writeup with a real re-test.
- **Current file**: `frontend/css/styles.css`, `.row` (lines 382–391): `min-height: 56px`,
  `padding: 6px 12px` (down from the `44px`/`12px 16px` an earlier round described) — this is a
  different, already-fixed layout, not the one D2 was originally filed against.
- **Expected** (AC-2.3a, design.md §3.1): at 375×553, the headline, counter pill, all 3 recent
  rows, and the Log button are all fully visible with zero vertical scroll.
- **Actual, freshly re-measured this round**: `specs/02-home-headline.spec.js`'s `AC-2.3a` test
  **passes** on `mobile-light`, `mobile-dark`, and `desktop-light`. Direct bounding-box reads
  against the exact same fixture (3 recent rows, `todayCount: 3`) via a temporary in-repo
  measurement test: rows measure 56–57px each (matching the documented 56px floor), and the Log
  button's bottom edge sits at **y = 531.09px — 21.91px of slack inside the 553px viewport**,
  not past it. `tests/screenshots/16-home-viewport-375x553-light.png` (re-captured this round)
  confirms visually: the Log button sits fully inside the viewport with clear margin below it.
- **Conclusion**: **D2 is genuinely fixed and closed.** AC-2.3 moves FAIL→PASS (see §2/§3). No
  further action needed on this item; Dathan's checklist (§6) no longer needs to re-check it.

### Fixed and confirmed this pass — D1: Delete/Undo row controls were 40×40, not ≥44×44
- **Was**: `frontend/css/styles.css` `.row__delete`, `width: 40px; height: 40px`.
- **Now**: `.row__delete` (lines 418–420 today) is `44px`×`44px`. Directly re-measured in
  Chromium: Delete button 44×44, Undo button 63.9×44 (both meet ≥44×44), Log button min-height
  64px unchanged. `AC-10.1` and `AC-16.6d` both **PASS** now (were the two FAIL rows for this
  defect).

### Fixed and confirmed this pass — D3: duplicate "Try again" buttons
- **Was**: `frontend/js/home.js`'s `renderPetLoadError` set `buttonText`/`onButtonClick` on the
  error panel's own button *and* relabeled `#log-button` to "Try again" — two visible retry
  controls at once.
- **Now**: `renderPetLoadError` (lines 633–647 today) explicitly does *not* pass
  `buttonText`/`onButtonClick`, with a comment noting why. Directly re-verified with a repro
  matching the original defect exactly (two consecutive pet-load failures): exactly 1 "Try
  again" button both times. A **new permanent regression test** was added this pass (see below)
  since no existing spec test actually covered this exact panel — fix round 1's own AC-16.5e
  had been repurposed for a different scenario (S13 paused hint) along the way, silently
  dropping automated coverage for the original defect.

### Fixed and confirmed this pass — D4: heatmap never rendered for a zero-feed pet
- **Was**: `frontend/js/history.js`'s `render()` returned early inside the zero-feeds branch,
  before ever calling `ensureHeatmapDataAndRender()`.
- **Now**: `render()` (lines 311–332 today) calls `ensureHeatmapDataAndRender()` unconditionally,
  after choosing `renderEmpty()` or `renderGroups()` — the heatmap card no longer depends on
  the day-grouped list being non-empty. Directly re-verified with the exact zero-feed fixture
  (`mockHistoryFirstPage(page, [])`): the heatmap renders all-zero-tier cells, and today's cell
  correctly shows its "today" outline. `AC-18.4` **PASS** now (was FAIL).
- Also confirmed as part of this same fix: `history.js`'s `deleteFeed()` now calls the full
  `render()` (not a partial re-render) after a delete, so deleting the *last* feed shows S10's
  empty state immediately, and the heatmap paging logic (`oldestLoadedIsWithinHeatmapRange` /
  `loadOlder({ forHeatmap: true })`) fetches additional pages only when genuinely needed to
  cover the heatmap's 5-week window — both read correctly in the current source and are
  exercised without failure across the full mocked-history test set (AC-12.3b, AC-18.1, AC-18.7b).

### Fixed and confirmed this pass — day-heading mislabeling (midnight–3AM boundary)
- Not one of the original 4 defects — new this pass, per the task hand-off. **Was**:
  `formatDayHeading` used the raw feed timestamp's calendar date for the non-Today/Yesterday
  heading text, so a feed logged between midnight and 3 AM (whose *feed day* is the previous
  calendar date) could show under a heading naming the *wrong* date, even though it was
  correctly bucketed.
- **Now**: `frontend/js/logic.js`'s `formatDayHeading` (lines 155–165) derives the displayed
  date from `startOfFeedDay(date)`, not `date` directly. Directly re-verified with a dedicated
  repro: a feed at 1:30 AM on a given calendar date (feed day = the previous calendar date)
  now renders its heading as "Monday, September 7" (the correct feed day), not "Tuesday,
  September 8" (the calendar date of the raw timestamp, which is what the bug would have shown).

### Confirmed still correctly withdrawn — "D5"
Unchanged from fix round 1: documentation drift (design.md §2 was stale after a pre-v1.1
redesign), not a frontend defect. AC-16.2 stays PASS.

### Fixed and confirmed this round — D6: "This feed was deleted." could lose its race against the caller's own background refresh under zero real-world latency
- **Status: fixed by the Frontend agent, confirmed this round.** Originally filed (below) as a
  low-severity, not-blocking finding — the Frontend agent fixed it anyway. `home.js` and
  `history.js` now delay the `alreadyDeleted` background refresh by a new
  `EDIT_DELETED_MESSAGE_DELAY_MS` constant (1200ms) before firing it, giving the row's own
  message a deadline-guaranteed reading window instead of relying on incidental microtask
  ordering. **Re-confirmed this round**: `AC-21.6b`/`AC-21.6c` pass 5/5 clean runs each — and,
  to isolate the app fix from the QA-side mock workaround below, re-run again 5/5 clean with
  that workaround's `getDelayMs` option removed entirely (i.e. against a zero-latency mocked
  GET, the exact condition that used to be flaky). The app-side fix alone eliminates the race.
  `tests/e2e/helpers/mock.js`'s `getDelayMs` option is no longer needed for this scenario and
  has been left in as a general-purpose opt-in only (its own doc comment updated accordingly);
  `21-edit-time.spec.js`'s `AC-21.6b`/`AC-21.6c` no longer pass it, so they keep exercising the
  real fix rather than a mock-side crutch.
- **Original finding, for the record** (severity was low even before the fix):
- **Files**: `frontend/js/home.js`'s `editFeedTime` and `frontend/js/history.js`'s `editFeedTime`
  (identical pattern in both) — on `alreadyDeleted`, both call `refresh({ background: true })`
  without awaiting it, then return, deliberately *not* re-rendering the list synchronously (per
  the Frontend agent's own documented intent: "give the row's own 'This feed was deleted.'
  message a real visible window before the row disappears on the next refresh tick").
- **Expected**: the message is always visible for at least a moment before the background
  refresh removes the row (design.md §3.6b's intent, and this pass's own task brief: "don't
  treat this as a defect unless the message never appears at all, or never actually clears").
- **Actual — confirmed by direct, repeated repro**: with the background refresh's GET mocked at
  its natural (zero-latency, same-process) speed, the scenario is **flaky**: `AC-21.6b` (home)
  failed 1 of 3 isolated runs, `AC-21.6c` (history) failed 1 of 5 — in each failing run, the
  background refresh's own full list re-render won the race and removed the row *before*
  Playwright's `toBeVisible` polling (5s timeout) ever observed the message painted; the DOM
  snapshot at failure time showed the list already empty ("No feeds logged yet") with only the
  screen-reader-only live-announcer region still saying "This feed was deleted" — i.e. a sighted
  user watching that exact run would never have seen the message either. Re-running the same
  scenario with a small (50ms) artificial delay on the background refresh's GET — much *faster*
  than any real Supabase round trip — made it pass reliably across 12/12 runs. **Root cause is
  timing, not logic**: the row's own local `edit-deleted` render is scheduled as a microtask
  continuation of the very `Promise` the background refresh is *also* chained off of, so in
  principle it should always win — but with a same-tick, zero-latency mocked response, Node/
  Chromium's actual scheduling order isn't 100% guaranteed race-free in practice (confirmed
  empirically, not just reasoned about).
- **Why this is low severity, not a blocker**: the real Supabase backend never responds in
  literally zero time — any genuine network round trip (even a fast one, tens of ms) gives the
  message's render far more of a head start than it needs, and this sandbox's own network is
  fully blocked, so the exact failure condition (near-zero-latency GET) can't even be exercised
  against the real system to confirm it's a live risk. This is reported so it's on record, not
  because it's expected to bite a real user.
- **Fix actually applied** (this is what landed, matching the spirit of the "suggested fix"
  floated when this was first filed): a minimum-dwell delay (`EDIT_DELETED_MESSAGE_DELAY_MS`,
  1200ms) before the background refresh's GET fires on the `alreadyDeleted` path specifically —
  see the "Status" note at the top of this entry for the re-confirmation.
- **Test suite**: the temporary `getDelayMs` mitigation described above (a mock-side artificial
  GET delay) has been removed from `21-edit-time.spec.js` now that the real, app-side fix makes
  it unnecessary — see the "Status" note above for the with/without comparison.

### Fixed and confirmed this round — D7: no-op Save (unchanged time) could rewind a feed's seconds/milliseconds on real data
- **Status: fixed by the Frontend agent, confirmed this round.** Found because an Opus review
  flagged that `21-edit-time.spec.js`'s `AC-21.5a` fixture used an artificially clean
  (whole-minute, zero-second) `created_at` — real Supabase timestamps always carry
  seconds/microseconds, and that fixture choice could never have caught this bug even if it
  were present, because a zero-second original happens to already equal the ms-exact
  "unchanged" check's own candidate value.
- **Bug** (as it existed before the fix): `computeEditedTimestamp` (contract.md §7.11) always
  constructs its edited candidate at exactly `HH:MM:00.000` (all an `<input type="time">` value
  can express) and compares it to the *original* `created_at` at full millisecond precision to
  decide `unchanged`. Since a real feed's `created_at` is essentially never exactly
  `:00.000` seconds, that comparison could practically never be true for real data — so tapping
  Save with the input showing the SAME displayed time (nothing user-visibly changed) would
  still be treated as a real change, firing a PATCH that rewound the feed's `created_at` to
  `:00.000` seconds. A real, if narrow (no visible symptom besides losing sub-minute precision
  silently), correctness bug.
- **Fix**: `frontend/js/ui.js`'s `confirmEdit` now runs a minute-granularity no-op guard
  *ahead* of `computeEditedTimestamp` — it compares the input's current value to
  `timeInputValue(new Date(feed.created_at))` (i.e. at the same HH:MM granularity the input
  itself uses) and short-circuits straight to `cancelEdit()` with no network call when they
  match, before `computeEditedTimestamp`'s own ms-exact check ever runs (kept as a defensive
  fallback, per its own comment in the source).
- **Re-verified this round**: `21-edit-time.spec.js`'s fixtures were rebuilt with a
  `realisticFeedIso()` helper (non-zero seconds/ms throughout, `:17.342`) so `AC-21.5a` (and
  every other test in the file) now actually exercises real-shaped data. Re-run: 17/17 pass,
  stable across 3 repeated full-file runs. `AC-21.5a` specifically: opening Edit on a feed at
  `07:42:17.342`, not touching the input, and tapping Save sends **zero** PATCH requests
  (counted directly) — confirming the guard works, not merely that no error was shown.

### Test-suite fixes made this pass (v1.2) — not frontend defects, listed for completeness
Eight QA-side issues were found and fixed while building/extending and then correcting the
v1.2 suite (the first six while building it; the last two — 7 and 8 — during the corrected
round, per the Opus review described in §0):

1. **New `specs/21-edit-time.spec.js` (AC-21.2b) — stale `.nth(1)` index.** The test assumed
   both rows' own Edit buttons stayed visible/indexed throughout, but `ui.js`'s `render()` only
   shows a row's own Edit/Delete icons in its `'normal'` state — once one row enters
   `'editing'`, its Edit button disappears from the DOM, shifting `.nth()` indices out from
   under the test. **Fixed**: changed the second `rowEditButton(page).nth(1)` to `.first()`,
   since only one row's Edit button is ever rendered at that point in the flow.
2. **Same file (AC-21.6a/b/c) — locator scoped to a class that changes mid-flow.** All three
   tests captured `const row = page.locator('.row--edit-open')` once, while the row was
   `'editing'`, then reused that same locator after Save — but `ui.js`'s `render()` swaps that
   class for `.row--confirm` the instant the state becomes `'edit-failed'`/`'edit-deleted'`
   (mirroring the pre-existing delete-failed pattern), so the stale locator stopped matching
   anything right when each test needed it most. **Fixed**: scope to the stable `<li>`
   (`recentRows(page).first()`, role-based, persists across the row's own internal state
   changes) instead of a class that's deliberately transient.
3. **`specs/19-csv-export.spec.js` (AC-19.4b) — route-registration race.** Registering
   `net.failWith5xx(...)` right after `gotoHistory` could race the app's own initial fetch,
   since v1.2 moved the CSV button inside `#heatmap-card` (hidden until the first load
   completes) — an intentional v1.2 behavior change, not a bug, but one that could
   permanently hide the button/heatmap card if the failing route won the race. **Fixed**:
   wait for the button to be visible *before* registering the failing route. Also fixed a
   stale `toHaveText(/Download CSV/)` assertion — v1.2 shortened the visible label to "CSV".
4. **`specs/17-pets.spec.js` (AC-17.6) — fixture/regression conflict.** This pass updated
   `config.js`'s default `PETS` fixture to carry real `photo_url`s (mirroring the live, v1.2
   database), which would have silently defeated AC-17.6's own placeholder-distinguishability
   test (it needs a *missing* `photo_url` to exercise the placeholder path at all — now a
   hypothetical-only path per spec.md's own AC-20.1 note, since all 3 real pets have photos).
   **Fixed**: AC-17.6 now explicitly overrides `photo_url: null` via `mockPetRows()`'s
   `overrides` param, with a comment explaining why.
5. **`specs/16-look-and-feel.spec.js` (AC-16.6d) — real-network hang.** `page.waitForResponse`
   for a real (unmocked, sandbox-blocked) POST never resolves, because a browser-side `fetch`
   failure doesn't emit an HTTP response event the way Node's `fetch` does (which fails fast
   with `403`) — this silently turned into a 45s hang rather than a fast, clearly-BLOCKED
   failure. **Fixed**: mock both the GET and POST via `mockHomeDataAndWrites` instead of
   hitting the real network at all for this specific tap-target assertion.
6. **`specs/00-rest-direct.spec.js` (AC-5.2b) — stale expectation, now superseded by v1.2's own
   contract change.** Previously asserted that ANY PATCH setting `created_at` (past or future)
   must be rejected — this was true in v1.1 but is now wrong per contract.md's v1.2 change
   (past/near-future values are allowed; only far-future ones are rejected, via `23514`, a
   CHECK-constraint violation, not a grant error). **Fixed**: rewrote AC-5.2b to expect success
   for a past value, and added 3 new tests (`AC-5.2c` future→`23514`, `AC-21.8a` `pet_id`
   PATCH→`42501`, `AC-21.8b` `logged_by` PATCH→`42501`) — all BLOCKED in this sandbox via
   Playwright (network), independently confirmed instead via direct SQL (see AC-21.8's row in
   §3 and the evidence file it names). This is a docs-drift issue in spec.md's own AC-5.2
   prose, not a frontend defect — see the note on AC-5.2's row in §3.
7. **`specs/02-home-headline.spec.js` (AC-2.3a) — D2 reported as still-open from stale
   evidence, without actually re-running the test.** The first draft of this report reused
   v1.1's old FAIL verdict and old CSS description for D2 rather than re-running `AC-2.3a`
   against this pass's build, which already has a different, already-fixed `.row` layout.
   **Fixed**: actually re-ran `AC-2.3a` (it passes, on all 3 relevant projects) and replaced
   the stale writeup with fresh measurements — see D2, above.
8. **`specs/21-edit-time.spec.js` — every fixture used an artificially clean (whole-minute)
   `created_at`.** `new Date(2026, 8, 16, H, M, 0, 0)` throughout meant no test in this file
   could have caught a real seconds/ms-level bug even if one were present, since a real
   Supabase `created_at` never has exactly `:00.000` seconds. This specifically masked D7 (a
   real no-op-Save rewind bug, since fixed — see above). **Fixed**: added a
   `realisticFeedIso(hour, minute)` helper (non-zero seconds/ms, `:17.342`) and rebuilt every
   ORIGINAL feed timestamp in the file to use it (expected-*result*-of-an-edit timestamps were
   deliberately left alone — contract.md §7.11 always constructs those at exactly
   `HH:MM:00.000`, so asserting a clean value there is correct). One knock-on fix was needed:
   `AC-21.3a`'s headline assertion ("12h 18m ago") shifted to "12h 17m ago" now that the
   original timestamp is 17.342s later than a whole-minute value would be — corrected with a
   comment explaining why. Re-run: 17/17 pass, stable across 3 repeated full-file runs.

### Test-suite fixes made this pass (v1.1) — not frontend defects, listed for completeness
Two QA-side bugs were found and fixed while re-verifying, each making genuinely-correct app
behavior intermittently or consistently read as FAIL:

1. **`specs/10-delete.spec.js` AC-10.4 — race condition.** The test registered
   `net.failFirstThenAllow(page, { methodFilter: 'PATCH', mode: 'abort' })` immediately after
   `gotoHome(page)` resolved, without confirming the page's own initial `getPets()` →
   `getRecentFeeds()` fetch chain had actually finished. `page.goto(..., { waitUntil: 'load' })`
   can resolve before those async in-page fetches complete, and Playwright's
   most-recently-registered-route-runs-first order means the newly-registered route — whose
   `route.continue()` for non-PATCH methods sends straight to the (sandbox-blocked) real network
   rather than falling through to the earlier `mockHomeData` handler — could still be racing the
   initial GETs. Confirmed by direct repro (reproduced the exact "Can't load feeds" failure
   outside the test runner, then fixed it by waiting for the row to render first). **Fixed**:
   the test now waits for the Delete button to be visible before registering the fail-route.
   Verified reliable across mobile-light, mobile-dark, and desktop-light (3 clean runs each
   after the fix).
2. **`specs/16-look-and-feel.spec.js` AC-16.5e — missing `mockPets(page)`.** `net.abortRequests`
   only targets the feeds endpoint (by design), so without mocking pets first, the real (and in
   this sandbox, blocked) `/rest/v1/pets` call failed on its own and sent the app down the
   unrelated pet-load-error path instead of the feeds-load-error path (with its paused-hint
   tracking) this test means to exercise. Confirmed by direct repro: with pets mocked, the real
   feeds-only failure path correctly shows "database may be paused" after 2 consecutive
   failures. **Fixed**: added `await mockPets(page)` before the fault injection.
3. **New regression test added**: `specs/16-look-and-feel.spec.js`, "D3 regression — exactly one
   'Try again' control after two consecutive pet-load failures". Fix round 1's spec changes had
   repurposed the old AC-16.5e (which originally caught defect D3) for a different scenario
   (S13's paused hint), leaving no automated test actually covering the pet-load-error panel
   D3 was about. This closes that gap permanently, independent of this report.

### DOM hooks / judgment calls — confirmation (unchanged from fix round 1)
- `data-today="true"`, `data-heatmap-expanded="true"`, legend text `"0 · 1 · 2 · 3 · 4+"` — all
  still used successfully; no issue.
- AC-18.5 judgment call (tap a zero-feed cell → nothing happens) and AC-19.4 judgment call
  (failed CSV export → persistent inline line + Retry) both still confirmed working as
  documented.

### Minor informational note (v1.2, not a defect) — `backend/schema.sql` vs. contract.md §2
Diffed this pass: `backend/schema.sql`'s v1.2 additions (the widened `created_at` UPDATE grant,
the `feeds_created_at_not_future` CHECK constraint) are functionally identical to contract.md
§2's description — same grant, same constraint expression, same behavior, confirmed directly
against the live DB (see AC-21.8's row in §3). The only difference found is in comment text
(non-functional). Not worth filing; noted only for completeness.

## 5. Build notes (from the frontend hand-off, relayed by the orchestrator)

**v1.1**: Frontend's round-1 fix hand-off reported 7 fixes (day-heading date-text, heatmap
unconditional render, heatmap paging direction, duplicate retry buttons, 375×553 tap
targets/picker shrink, 44×44 row delete buttons, species-appropriate tagline) plus 3 more
(empty state after last-feed delete, cat-ear placeholder shape, a stale code comment trim),
with 71/71 unit tests passing in both timezones. That pass independently confirmed all of the
above except the 375×553 fix, which at that time was real but insufficient (D2, open as of
that pass — since fully fixed by a later round's further padding reduction; confirmed fixed in
§4 of this report).

**v1.2 (this pass)**: Frontend implemented all 3 v1.2 features (F19's AC-19.6 CSV-button
move/restyle, F20's real photos, F21's edit-time flow) on top of that build. Independently
re-verified every v1.2 [QA] AC directly against the current source, a live repro, and/or direct
SQL — not merely re-read from the hand-off:
- `frontend/js/logic.js`'s `computeEditedTimestamp` and `editAriaLabel` match contract.md
  §7.11's spec exactly, including the DST-safe field-based construction.
- `frontend/js/constants.js`'s `EDIT_FUTURE_GRACE_MS` (5 min) matches the DB's own
  `feeds_created_at_not_future` CHECK constraint exactly (confirmed via direct SQL: a value 4
  minutes ahead succeeds, one 1 day ahead fails with `23514`).
- `frontend/js/api.js`'s `updateFeedTime` matches contract.md §6.H exactly (PATCH body,
  `deleted_at=is.null` filter, `alreadyDeleted` resolution on an empty-array response).
- `frontend/js/ui.js`'s row component correctly implements the full edit-time state machine
  (`normal → editing → saving-edit → {normal | edit-failed | edit-deleted}`), sharing the
  existing "one open row at a time" controller with delete-confirm.
- `frontend/js/home.js` and `frontend/js/history.js` both correctly avoid a synchronous
  re-render on `alreadyDeleted`, per the documented design intent.
- `frontend/assets/{zuumi,banh-mi}.jpg` both exist, 176×176 (matching `pumo.jpg`), and
  `pets.photo_url` is set for all 3 rows on the live database (confirmed via Supabase MCP).
- 79/79 unit tests pass in both timezones (up from 71/71 — 8 new `computeEditedTimestamp`
  cases).

**v1.2, corrected round — additional Frontend fixes confirmed**: after this report's first
draft, the Frontend agent shipped 3 more fixes, all independently re-verified against the
current source and a live repro (not merely re-read from a hand-off):
- **D2** (`frontend/css/styles.css`'s `.row`) — the 375×553 overflow is genuinely fixed (this
  was actually a pre-existing fix this report's first draft simply failed to re-test — see §0
  and §4).
- **D6** (`frontend/js/home.js`/`history.js`) — a new `EDIT_DELETED_MESSAGE_DELAY_MS` (1200ms)
  delay before the `alreadyDeleted` background refresh, giving the row's "This feed was
  deleted." message a deadline-guaranteed reading window. Re-confirmed 5/5 clean runs, both
  with and without the QA-side mock workaround this report had been using — see §4.
- **D7** (`frontend/js/ui.js`'s `confirmEdit`) — a minute-granularity no-op-Save guard ahead of
  `computeEditedTimestamp`'s own ms-exact check, fixing a real timestamp-rewind bug on
  realistic (non-zero-second) data. Re-confirmed with rebuilt test fixtures — see §4.
- Also confirmed: the CSV-export failure message's spacing fix (`#csv-error` in
  `frontend/css/styles.css` — left-aligned, `margin-bottom: 12px`, no longer crammed against
  the legend row below it). Screenshot re-captured and looks correct — see the screenshot
  inventory below.

## 6. Dathan's post-deploy checklist (real phones)

Unchanged from prior passes unless marked **(v1.2)** — none of these are QA's to run:

- [ ] **AC-1.1** — the NTAG213 sticker holds exactly one NDEF URL record containing LIVE_URL (https, ≤100 characters).
- [ ] **AC-1.2** — with the sticker in its final spot, tap it 3 of 3 times on every household phone.
- [ ] **AC-17.8 (v1.1)** — Zuumi's and Banh Mi's stickers are programmed with their own URLs (`LIVE_URL?pet=zuumi`, `LIVE_URL?pet=banh-mi`), each tested on at least one phone.
- [ ] **AC-6.2 on real hardware** — a real iPhone (Safari) and a real Android phone (Chrome): log from one, confirm the other shows it within 2s after switching back.
- [ ] Set a name on each of the 4 household phones (F14) and confirm it appears in the footer and on new feed rows.
- [ ] Confirm dark mode looks right on each phone.
- [ ] Do one real feed, one Undo, and one Delete end to end on a real phone — for at least 2 of the 3 pets, not just Pumo.
- [ ] Confirm the heatmap and CSV button both work from a real phone for at least one pet.
- [ ] **(v1.2) Full edit-time cycle, end to end on a real phone, for at least one non-default
      pet**: open the editor on a real row → change the time → Save → confirm the row, the "n of
      4 today" counter, the day-grouping, and (on history) the heatmap all update. This pass
      verified the full cycle only via mocked Playwright tests (`21-edit-time.spec.js`) plus
      direct SQL-as-`anon` evidence for the DB-level rules (see AC-21.8's row in §3 and
      `tests/e2e/evidence/ac-21.4-21.8-sql-verification.json`) — this sandbox's blocked network
      means **no real UI-driven edit was ever run against the live database**. This is the one
      item tasks.md §2's own Done-means checklist explicitly calls out as needing a real-network
      confirmation (the future-time DB rejection itself, `23514`, **was** confirmed via direct
      SQL this pass, satisfying that half of the same checklist item).
- [ ] **(v1.2) Zuumi's and Banh Mi's real photos** show correctly on at least one real phone,
      in both light and dark mode (this pass confirmed the data/rendering is correct via
      Playwright + direct SQL, but never on a real device's actual screen/color profile).
- [ ] **Given this pass's 26 BLOCKED rows (all carried forward from v1.1 — v1.2 added none)**:
      this sandbox cannot reach the real Supabase project or deploy at all, so every BLOCKED row
      in §3 — the real write/read round trip for logging, undo, delete, the recent/daily
      guards' confirming taps, CSV export, cross-device sync, and now the full v1.2 edit-time
      cycle above — has only ever been verified as source-correct + unit tested + (where
      mocked) pure-client correct, never against the live system end-to-end. Strongly recommend
      Dathan (or a CI environment with real egress) re-run at minimum: one full
      log→undo→delete→edit cycle per pet, one CSV export from its new location, and one
      cross-device sync check, before treating v1.2 as fully done. (D2, the 375×553 viewport
      item earlier drafts of this report flagged for a real-phone re-check, is now confirmed
      fixed via a real re-test — see §4 — so no real-phone re-check of it is needed.)

## 7. Test data

**No live `QA-test` rows exist for any pet** — confirmed directly this pass via SQL against the
live Supabase project (`select count(*) from public.feeds where logged_by = 'QA-test' and
deleted_at is null` → `0`), re-checked at the end of this v1.2 pass after the SQL-as-`anon`
verification work in §3/§4 (AC-21.8, D6). That work *did* create and fully clean up one test row
(id `970f86d8-18c0-4fef-851a-1552a3a8e479`, Zuumi, `logged_by: 'QA-test'`) directly via the
Supabase MCP connector, ending soft-deleted as part of the `alreadyDeleted` check itself — see
`tests/e2e/evidence/ac-21.4-21.8-sql-verification.json` for the full statement-by-statement
trail. No Playwright-driven writes were possible from this sandbox this pass (Node-side REST
gets an immediate `403` before any row could be created), and `QA_SKIP_REST_CLEANUP=1` was used
to skip the now-unreachable cleanup step in `helpers/fixtures.js`'s `beforeEach`. **No
live-database cleanup is owed from this pass.**

## 8. Sanity checks performed this pass (v1.1 pass — unchanged, kept for history)

- **Console errors**: zero real console errors across 3 pets × {home, history} × {light,
  dark} = 12 combinations, checked directly via a fresh Playwright/CDP script.
- **Unit tests**: 71/71 pass under both `America/Los_Angeles` and `UTC`.
- **Migration state**: confirmed via direct SQL — `pets` has exactly the 3 seeded rows in the
  right `sort_order`; `feeds.pet_id` has 0 nulls.
- **AC-5.2 / AC-11.1 / AC-11.2**: verified via direct SQL — `anon` insert/update of `created_at`
  is rejected, `anon` delete is rejected and the row survives, and a soft-deleted row correctly
  persists with `deleted_at` set. (**Superseded by v1.2 for the UPDATE half — see below.**)
- **Full Playwright re-run**: all 5 projects, every spec file, not a delta run — 142 tests per
  browser project. This is how AC-2.3b's one transient failure in the desktop-light background
  run was caught as a Playwright trace-file I/O artifact, and how D2's still-open status was
  caught in the first place.

## 8b. Sanity checks performed this pass (v1.2)

- **Unit tests**: 79/79 pass under both `America/Los_Angeles` and `UTC`, re-run directly this
  pass (`node --test tests/unit/logic.test.mjs` — the bare-directory form doesn't work in this
  sandbox's Node, a pre-existing environment quirk, not a defect).
- **v1.2 migration state**: confirmed via direct SQL this pass — `pets.photo_url` set for all 3
  rows; `feeds`'s `created_at` UPDATE grant widened for `anon`; the `feeds_created_at_not_future`
  CHECK constraint exists exactly as contract.md documents.
- **AC-5.2 (UPDATE half, v1.2 behavior change) / AC-21.8 / D6's timing claim**: re-verified via
  direct SQL-as-`anon` this pass (not merely re-read from the v1.1 pass's evidence) — `anon`
  INSERT of `created_at` is still rejected (unchanged from v1.1); `anon` UPDATE of `created_at`
  to a past or near-future (≤5 min) value now **succeeds** (the v1.2 change); to a far-future
  value it fails with `23514`; `pet_id`/`logged_by` UPDATEs both still fail with `42501`; a
  PATCH-style update filtered by `deleted_at is null` on an already-soft-deleted row correctly
  returns zero rows (the `alreadyDeleted` shape). Full trail in
  `tests/e2e/evidence/ac-21.4-21.8-sql-verification.json`.
- **v1.2 Playwright re-run**: `mobile-light` project — `21-edit-time.spec.js` (17/17),
  `20-pet-photos.spec.js` (6/6), `19-csv-export.spec.js` (16/21, the other 5 are pre-existing
  BLOCKED real-network CSV tests unaffected by AC-19.6), plus regression re-runs of
  `10-delete.spec.js`, `16-look-and-feel.spec.js`, and `17-pets.spec.js` (42/45 passing — the 3
  failures are pre-existing, expected real-network BLOCKED tests: AC-10.3, AC-16.5g, AC-17.4).
  No new regressions found in any pre-existing spec from the v1.2 DOM/behavior changes (the new
  `.heatmap__header` wrapper, the row's second icon button, the widened `created_at` grant).
- **AC-21.6b/AC-21.6c flakiness (D6, as first found)**: independently reproduced by running
  each test in isolation 3–5 times before the app-side fix landed — see D6 in §4 for the
  before/after numbers (the "after" numbers are from the corrected round below).
- **Live-database cleanup**: confirmed 0 live `QA-test` rows both before writing D6's evidence
  file and again at the end of this pass (see §7).

## 8c. Sanity checks — corrected round (this report, after the Opus review)

- **AC-2.3a (D2)**: actually re-run against the current build — `mobile-light`, `mobile-dark`,
  `desktop-light` all pass. Fresh bounding-box measurements taken via a temporary in-repo
  Playwright test (not reused from any prior pass): recent rows measure 56–57px each; the Log
  button's bottom edge sits at y=531.09px against a 553px viewport (21.91px of slack).
  `16-home-viewport-375x553-light.png` re-captured and visually confirms the fit. Full detail
  in §4's D2 entry.
- **AC-21.5 / D7**: `21-edit-time.spec.js`'s fixtures rebuilt with realistic (non-zero-second)
  `created_at` values; full file re-run 3 times consecutively, 17/17 pass each time. Confirmed
  the specific no-op-Save scenario (AC-21.5a) sends zero PATCH requests against a feed whose
  `created_at` has real (`:17.342`) seconds, not just a whole-minute one.
- **D6, after the app-side fix**: `AC-21.6b`/`AC-21.6c` re-run 5/5 clean with the QA-side mock
  workaround (`getDelayMs`) still in place, then re-run again 5/5 clean with that workaround
  removed entirely (i.e. against a zero-latency mocked GET, the exact condition that used to
  be flaky pre-fix) — confirming the app's own `EDIT_DELETED_MESSAGE_DELAY_MS` fix, not test
  timing, is what makes this reliable now.
- **CSV failure-message spacing fix**: `19-csv-export.spec.js`'s `AC-19.4b` re-run (passes);
  `19-history-csv-failed-light.png` re-captured fresh against the current build and reviewed
  visually — left-aligned message, proper spacing above the legend row, no regression to the
  CSV button or Retry control's own layout.
- **No regressions from any of the above**: re-ran `10-delete.spec.js`, `16-look-and-feel.spec.js`,
  `17-pets.spec.js`, and `02-home-headline.spec.js` together (50/54 passing — the 4 failures
  are the same pre-existing, expected real-network BLOCKED tests as every other pass:
  AC-2.5b, AC-10.3, AC-16.5g, AC-17.4).
- **Live-database cleanup**: re-confirmed 0 live `QA-test` rows after this round's work (no new
  SQL writes were made this round — only re-reads).

## 8d. Sanity checks performed this pass (v1.3, F22 — see §2b)

- **Unit suite**: `tests/unit/logic.test.mjs` re-run in full (not just the touched
  `feedsToCsv` suite) under both `TZ=America/Los_Angeles` and `TZ=UTC` — 79/79 pass both times.
- **CSV icon-only + inline-with-legend**: `19-csv-export.spec.js`'s mocked tests re-run —
  `AC-19.1b`, `AC-19.2b`, `AC-19.3c/d`, `AC-19.4b`, `AC-19.5`, `AC-19.6a` (rewritten for
  AC-22.1) through `AC-19.6d` all pass. The real-network variants (`AC-19.1a`, `AC-19.2a`,
  `AC-19.3a/b`, `AC-19.4a`) were not re-run — same pre-existing sandbox egress block as every
  prior pass, and this round doesn't touch anything on the server side for them to catch.
- **CSV newest-first order, end to end**: beyond the fixture check (`AC-19.3c`), a one-off
  Playwright script (not committed — ad hoc verification only) clicked the real button against
  a 2-feed mock and parsed the real downloaded file, confirming `['Newer', 'Older']` order.
- **Avatar size bump vs. AC-2.3a's fit budget**: `02-home-headline.spec.js`'s `AC-2.3a`/`AC-2.3b`
  re-run against the new 32px/36px sizing (local static server, since this needed to be
  checked before, not after, deploying) — both still pass, no other layout changes needed.
- **Legend visibility/position, heatmap axe scan**: `18-heatmap.spec.js`'s `AC-18.6` and
  `AC-18.6b` (axe, no serious/critical violations) re-run — both pass; the icon-only CSV button
  losing its visible text doesn't trip the scan since its aria-label is unchanged.
- **Broader regression sweep**: `17-pets.spec.js`, `18-heatmap.spec.js`, `16-look-and-feel.spec.js`
  run together against the local build (mobile-light) — 46 passed, 4 failed. 3 of the 4 are the
  same pre-existing real-network BLOCKED pattern as every prior pass. The 4th
  (`18-heatmap.spec.js`'s `AC-18.1`) is the same pre-existing, already-documented
  test-infrastructure flake noted in §2's table above (INCONCLUSIVE, "carried forward from
  v1.1, unchanged") — independently reproduced and re-confirmed this round: the page snapshot
  captured at the moment of failure shows the heatmap, legend and CSV button all rendered
  correctly (35 cells, correct legend content, button in the header), and a raw
  `playwright-core` script against the identical mocked fixture takes the same screenshot
  successfully in under a second — the hang is specific to `page.screenshot()` running inside
  this sandbox's Playwright test-runner process, not a rendering defect.
- **Pet photo re-crop**: no automated test can assert "the nose looks centered" — verified by
  eye, comparing the new `zuumi.jpg`/`banh-mi.jpg` against the pre-v1.3 crop and against
  `pumo.jpg`'s existing framing, plus the re-captured `20-home-pet-picker-*` screenshots below.
- **Live-database**: no SQL writes this round (no schema/data change) — nothing to clean up.

## 9. Ambiguities — status

Unchanged from fix round 1: all 5 original scaffolding-pass ambiguities remain resolved (see
prior passes' detail — heatmap grid formula, picker/header "same element," URL-rewrite
behavior, "pet didn't exist yet" heatmap wording, and the "first row"/"last row" doc typo). No
new ambiguities were found in v1.1 or this v1.2 pass beyond D2 (§4, still open) and D6 (§4, new
this pass, low severity).

## Screenshot inventory (`tests/screenshots/`)

**v1.3 note:** no new filenames this round — F22 changed pixel content only, re-captured under
the same existing names: `19-history-csv-header-{resting,preparing}-{light,dark}.png` (icon-only
button, inline with the legend), `20-home-pet-picker-real-photos-{light,dark}.png` and
`20-home-pet-picker-{zuumi,banh-mi}-real-photo-selected-{light,dark}.png` (re-cropped photos,
larger avatars), and `16-home-viewport-375x553-light.png` (AC-2.3a re-verification against the
new avatar size). The counts and file list below are the unmodified v1.2 inventory.

**73 files total.** This pass added 15 new v1.2 files (via `19-csv-export.spec.js`'s new
AC-19.6 tests, `20-pet-photos.spec.js`, and `21-edit-time.spec.js`), on top of the v1.1 pass's
own set (below, unchanged from that pass's own report). tasks.md §2's v1.2 minimum set is
covered:

- **CSV button restyled/repositioned in the heatmap card's header, resting + in-flight, light +
  dark**: `19-history-csv-header-{resting,preparing}-{light,dark}.png` (4 files, AC-19.6d).
- **Pet picker showing Zuumi's and Banh Mi's real photos, light + dark**:
  `20-home-pet-picker-real-photos-{light,dark}.png` (AC-20.1c), plus each selected as the large
  ringed avatar: `20-home-pet-picker-{zuumi,banh-mi}-real-photo-selected-{light,dark}.png` (4
  more files, AC-20.1d) — 6 files total.
- **Edit-time flow open (input pre-filled), on a home row and a history row**:
  `21-home-edit-open-light.png` (AC-21.2a), `21-history-edit-open-light.png` (AC-21.3b) — 2
  files.
- **Future-time-rejected error, on a home row and a history row**:
  `21-home-edit-future-rejected-light.png` (AC-21.4a), `21-history-edit-future-rejected-light.png`
  (AC-21.4b) — 2 files.
- **Edit-failed state**: `21-home-edit-failed-light.png` (AC-21.6a) — 1 file.
- **"This feed was deleted" state**: `21-home-edit-target-deleted-light.png` (AC-21.6b) — 1
  file.

tasks.md §2's own wording for this specific set (unlike the picker/heatmap/CSV-button items
elsewhere in that same list) does not explicitly require a dark-mode pair for each of the
edit-time states above — dark-mode versions were not captured this pass; the light-mode set
above is the literal minimum named.

**Re-captured this round (corrected round, same filenames — content refreshed against the
current, fixed build)**:
- `16-home-viewport-375x553-light.png` — now shows the Log button fitting inside the 375×553
  viewport with 21.91px of margin (D2, confirmed fixed — see §4), replacing the earlier draft's
  stale reference to a different, overflowing layout.
- `19-history-csv-failed-light.png` — now reflects the CSV-failure-message spacing fix
  (`#csv-error`), left-aligned with proper breathing room above the legend row.
- `21-home-edit-target-deleted-light.png` — re-captured against the Frontend agent's D6 fix
  (`EDIT_DELETED_MESSAGE_DELAY_MS`); content is the same "This feed was deleted." state, now
  produced by a deadline-guaranteed code path instead of one that used to race.

### v1.1 screenshot inventory (unchanged from that pass's own report, kept for history)

62 files total (57 from the prior pass + that pass's 6 fresh re-captures, net of the D3
regression test not itself adding a named screenshot). **Every previously-stale or
previously-missing file had been captured fresh against that pass's build**:

- `16-home-viewport-375x553-light.png` — **re-captured fresh this pass**, against the exact
  AC-2.3a fixture. This is the file that shows D2's remaining overflow directly: the Log
  button's bottom edge is visibly clipped by the viewport edge.
- `13-home-paused-hint-light.png` — **re-captured fresh this pass** (via the AC-16.5e test,
  now passing after the mockPets fix above), showing the real S13 paused-hint copy against the
  current build.
- `17-home-pet-picker-zuumi-selected-dark.png` — **re-captured fresh this pass** (manual capture
  matching AC-17.3c's fixture, since that spec test only captures light scheme by design).
- `18-history-heatmap-spread-{light,dark}.png` — **re-captured fresh this pass** (manual capture
  matching AC-18.1's fixture, since AC-18.1's own screenshot call hangs in the test runner per
  §2/§3's INCONCLUSIVE note).
- `19-history-csv-button-resting-light.png` — **re-captured fresh this pass** (no spec test
  captures this idle state by name; manual capture, mocked data).
- `19-history-csv-button-preparing-light.png` — **re-captured fresh this pass** (AC-19.4a's own
  version needs real network to seed a row and is BLOCKED in this sandbox; manual capture using
  mocked data + injected latency to reach the same "Preparing…" busy state instead).

The v1.1 minimum set from tasks.md §2 is complete, including: pet picker on home for all 3 pets
(light, plus dark for at least one); heatmap on history, light + dark, with a seeded tier
spread; heatmap today-marker and the expand/collapse pair; Download CSV button in all 3 states
(resting/preparing/failed); and a feed logged between midnight and 3 AM showing "Yesterday,
{time}" on both home and history.
