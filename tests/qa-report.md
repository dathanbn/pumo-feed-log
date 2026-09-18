# Pumo Feed Log — QA report

**Status: v1.1 FINAL verification pass, run against Frontend's round-1 defect-fix build**
(`frontend/` served locally, `build.txt` = `2026-09-18T06:12:54Z`, unchanged — this pass
re-tests the same build tree Frontend fixed in place, no new deploy was needed). All 5
Playwright projects were run in full (`rest-direct`, `source-checks`, `mobile-light`,
`mobile-dark`, `desktop-light` — every spec, not just the previously-failed items), plus
`tests/unit/` in both `America/Los_Angeles` and `UTC`. This supersedes the prior "fix round 1"
pass (§0 below is kept for history).

**Bottom line: 3 of 4 defects from fix round 1 are genuinely fixed (D1, D3, D4), plus the new
day-heading bug. One (D2, the 375×553 viewport overflow) is only *partially* fixed — it still
fails, by about 14px, at the exact viewport the acceptance criterion names.** See §4.

## 0. History

- **Scaffolding pass**: initial dry-run before the frontend build existed.
- **v1.1 real QA pass**: first full run against the real build. Found defects D1–D4 (see below)
  plus a documentation-drift issue (withdrawn "D5" — design.md §2 was stale, not the CSS).
- **Fix round 1** (Opus review of the QA pass + suite itself): fixed 7 QA-side test bugs, moved
  several BLOCKED rows to PASS via new mocked counterpart tests, corrected AC-16.2 (D5
  withdrawn), and re-measured AC-18.3's contrast claim properly. Frontend's D1–D4 fixes were
  still pending confirmation at the end of that round — §2's summary counts were deliberately
  left unreconciled pending this final pass.
- **This pass (final verification)**: Frontend reported all 4 defects + the day-heading bug
  fixed. Independently re-verified every claim below, re-ran the full suite (not just the
  previously-failing items — a shared-file change can affect more than what's explicitly
  listed), re-captured every stale/missing screenshot, found and fixed 2 more QA-side test
  bugs (a race condition and a missing mock, both documented in §4), added one permanent
  regression test that didn't exist before, and reconciled §2's counts for real. **Net result:
  found that D2 is not actually fully fixed** — see §4.

## 1. Header

| Field | Value |
|---|---|
| Tested URL | `http://127.0.0.1:8080` (`frontend/` served locally via `python3 -m http.server`) — this sandbox's network egress does not reach the real `LIVE_URL` deploy or `*.supabase.co` over plain HTTP(S) (confirmed directly: `curl` to the Supabase host gets `403` from the sandbox's egress proxy, and a real Chromium `fetch()` to the same host fails in ~235ms with `TypeError: Failed to fetch`, not a hang), so the served static files are byte-identical to what would deploy but no live-deploy/live-Supabase round trip was exercised end-to-end from here (see BLOCKED rows below and Dathan's checklist, §6). Direct SQL against the live Supabase project **is** reachable, via the Supabase MCP connector (server-side, not subject to the sandbox's HTTP egress policy) — used for AC-5.2/11.1/11.2 and test-data cleanup confirmation. |
| LIVE_URL (architecture.md §8) | `https://dathanbn.github.io/pumo-feed-log/` — not reachable from this sandbox this pass |
| `build.txt` | `2026-09-18T06:12:54Z` — unchanged from fix round 1 (no new deploy was needed for this verification pass; `frontend/build.txt` matches the served `/build.txt`) |
| Date / time of this pass | 2026-09-18 |
| Supabase project ref | `dufyzxtrhdcwrebagsfs`, region `us-east-2` — migration re-confirmed applied via direct SQL this pass (`pets` has exactly Pumo/Zuumi/Banh Mi in `sort_order`; `feeds.pet_id` has 0 nulls) |
| Browsers / devices | Chromium via Playwright (`tests/e2e/playwright.config.js`): `mobile-light`/`mobile-dark` (iPhone 13, 390×844), `desktop-light` (1440×900), plus in-test viewport overrides (375×553, 390×664) |
| Time zone | `America/Los_Angeles` (primary, all Playwright runs); unit tests also re-run under `UTC` |
| Unit tests | **71/71 pass** under both `TZ=America/Los_Angeles` and `TZ=UTC` (`node --test tests/unit/logic.test.mjs`), independently re-run this pass (up from the 70/70 an earlier pass reported — the suite grew by one case since) |
| Console errors | **Zero** real console errors across all 3 pets × {home, history} × {light, dark} = 12 combinations, re-checked directly this pass via a Playwright/CDP script. (Each combination shows exactly one *unrelated* sandbox-network error — the Google Fonts `<link>` failing to reach `fonts.googleapis.com` through this sandbox's proxy — which is an artifact of this environment, not the app, and would not occur on a real device with normal internet access.) |

## 2. Summary counts

Counted at AC granularity (86 total, matching spec.md's actual F1–F19 list — independently
re-verified this pass by diffing every `AC-\d+\.\d+` token in spec.md against every AC row in
§3 below: exact 1:1 match, no missing or duplicate ACs). **This corrects fix round 1's
`tests/qa-report.md` §2, which had been left showing pre-fix-round-1 numbers (PASS 36 / FAIL 6
/ BLOCKED 40) while §3's actual per-row table had already moved on — and separately corrects a
small arithmetic slip in that same, older §2: it claimed 6 FAIL rows where the table itself
only ever had 5.** The numbers below are freshly counted directly from this pass's own §3 table.

| Result | Count | Meaning |
|---|---|---|
| PASS | 55 | Confirmed directly via Playwright (mocked, source-check, or real-network-succeeded) or via direct SQL against the live Supabase project. Includes the 4 ACs that move FAIL→PASS this pass (AC-10.1, AC-16.5, AC-16.6, AC-18.4 — see §4) plus everything already PASS going into this pass, all re-confirmed by this pass's full re-run. |
| FAIL | 1 | AC-2.3 — genuine, reproducible, still-open frontend defect (D2, partially fixed). Full detail in §4. |
| BLOCKED | 26 | Sandbox network egress does not reach `*.supabase.co` over HTTP(S) — Node-side REST helpers get an immediate `403 Host not in allowlist`; browser-side (real Chromium `fetch`) fails fast (~235ms, confirmed directly) with no response, so anything waiting on a real HTTP *response* (`page.waitForResponse`) instead hangs to the 45s test timeout. Neither is a code defect — these ACs need a real network run (e.g. Dathan's phone, or CI with real egress) to get a verdict. Unchanged from fix round 1 — this pass's re-run reproduces the identical set. |
| INCONCLUSIVE (environment) | 1 | AC-18.1 — re-confirmed this pass: `page.screenshot()` hangs specifically inside the Playwright test runner in this sandbox (45s timeout, `Target page, context or browser has been closed`), while the exact same render sequence (mocked, no real network) completes correctly and instantly (35 cells, 5 rows, screenshot in 57ms) via a raw `playwright-core` script outside the test runner. Test-infrastructure issue, not a code defect. |
| DATHAN (not QA's to run) | 3 | AC-1.1, AC-1.2, AC-17.8 — physical hardware/sticker checks. |
| **Total** | **86** | |

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
| AC-2.3 | **FAIL** | `02-home-headline.spec.js` AC-2.3a (**FAIL**), AC-2.3b (**PASS**) | **[this pass]** Defect D2 — see §4. Round-1's fix (picker shrink + `.page` gap reduction) is real but not sufficient: the 375×553 viewport still overflows, now by ~14px instead of more. Reproduces identically in mobile-light, mobile-dark and desktop-light. |
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
| AC-5.2 | **PASS** (via direct SQL, not Playwright) | Re-verified directly against the live Supabase project this pass, via the Supabase MCP connector, `SET ROLE anon`-equivalent scoping: both an `INSERT ... created_at=...` and an `UPDATE ... created_at=...` as `anon` are rejected (`insufficient_privilege`), matching contract.md's "Calls that must fail" table. `specs/00-rest-direct.spec.js` AC-5.2a/b themselves report BLOCKED (Node-side `403` before even reaching Supabase) — the SQL check is the real verdict here. |

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

## 4. Defects

### Still open — D2 (partial fix): 375×553 viewport (iPhone SE, Safari toolbars) still overflows
- **Severity: should block shipping.** This is a named, testable acceptance criterion
  (AC-2.3a), and the element that ends up off-screen is the Log button — the app's single
  primary action — on a small-phone viewport that's a realistic member of "the 4 household
  phones" this app is built for, not a synthetic edge case.
- **File**: `frontend/css/styles.css`. Round 1's fix is real and does help — `.page`'s row
  gap was reduced 16px→8px (line 144) and `.pet-picker__item`/`.pet-avatar` were shrunk to a
  44×44 tap target with a 28/32px visual avatar (lines 188–222) — but it isn't enough.
- **Expected** (AC-2.3a, design.md §3.1): at 375×553, the headline, counter pill, all 3 recent
  rows, and the Log button are all fully visible with zero vertical scroll.
- **Actual**: directly measured in a live Chromium page, using the exact fixture
  `specs/02-home-headline.spec.js`'s AC-2.3a test uses (3 recent rows, `todayCount: 3`): the
  Log button's bottom edge sits at **y = 567.09px, 14.09px past the 553px viewport**. A
  screenshot of the actual rendered page at this viewport shows the Log button visibly clipped
  by the bottom edge.
- **Repro**: `AC-2.3a` fails identically in mobile-light, mobile-dark, and desktop-light (the
  test sets its own 375×553 viewport regardless of project). Reproduced independently outside
  the Playwright test runner too, with a raw bounding-box read, confirming this isn't a test
  artifact.
- **Root cause / what's left in the budget**: design.md §3.1 explicitly documents that,
  short of the two fallbacks Frontend already implemented, the recent-list rows may shrink as
  low as **56px** ("Never shrink the button below 64 px or the rows below 56 px") before the
  v1.1 picker-row fallback even comes into play. The currently-rendered rows measure **68–69px**
  each (`.row`, `frontend/css/styles.css` lines 382–389: `min-height: 44px` + `padding: 12px
  16px` — the 44px Delete button's own tap-target floor plus 24px of padding — 3 rows × up to
  ~12px of still-unused, doc-permitted slack each is ~36px, comfortably more than the 14px
  needed to close this gap. (Note: v1.1's own addendum to that same paragraph says the *newer*
  picker-row fallback should never touch the rows/button — but the *original*, still-current
  56px row floor is a separate, already-documented allowance that simply hasn't been used yet.)
- **Fix**: reduce `.row`'s vertical padding (e.g. `12px 16px` → `~8px 16px`) so rows sit closer
  to the documented 56px floor, or find an equivalent ~14px elsewhere in the already-permitted
  gap-shrink budget. Re-run `AC-2.3a` (`02-home-headline.spec.js`) to confirm before calling
  this closed a second time.

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

### Test-suite fixes made this pass (not frontend defects — listed for completeness)
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

## 5. Build notes (from the frontend hand-off, relayed by the orchestrator)

Frontend's round-1 fix hand-off reported 7 fixes (day-heading date-text, heatmap unconditional
render, heatmap paging direction, duplicate retry buttons, 375×553 tap targets/picker shrink,
44×44 row delete buttons, species-appropriate tagline) plus 3 more (empty state after last-feed
delete, cat-ear placeholder shape, a stale code comment trim), with 71/71 unit tests passing in
both timezones. **This pass independently confirmed all of the above except item 5 (the
375×553 fix): that one is real but insufficient — see D2 in §4.** Every other claim (day-heading,
heatmap unconditional render, heatmap paging, duplicate buttons, tap targets, tagline, empty
state, cat-ear shape, code comment) was independently re-verified directly against the current
source and/or a live repro, not just re-read from the hand-off.

## 6. Dathan's post-deploy checklist (real phones)

Unchanged from prior passes — none of these are QA's to run:

- [ ] **AC-1.1** — the NTAG213 sticker holds exactly one NDEF URL record containing LIVE_URL (https, ≤100 characters).
- [ ] **AC-1.2** — with the sticker in its final spot, tap it 3 of 3 times on every household phone.
- [ ] **AC-17.8 (v1.1)** — Zuumi's and Banh Mi's stickers are programmed with their own URLs (`LIVE_URL?pet=zuumi`, `LIVE_URL?pet=banh-mi`), each tested on at least one phone.
- [ ] **AC-6.2 on real hardware** — a real iPhone (Safari) and a real Android phone (Chrome): log from one, confirm the other shows it within 2s after switching back.
- [ ] Set a name on each of the 4 household phones (F14) and confirm it appears in the footer and on new feed rows.
- [ ] Confirm dark mode looks right on each phone.
- [ ] Do one real feed, one Undo, and one Delete end to end on a real phone — for at least 2 of the 3 pets, not just Pumo.
- [ ] Confirm the heatmap and CSV button both work from a real phone for at least one pet.
- [ ] **Given this pass's 26 BLOCKED rows**: this sandbox cannot reach the real Supabase project
      or deploy at all, so every BLOCKED row in §3 — the real write/read round trip for logging,
      undo, delete, the recent/daily guards' confirming taps, CSV export, and cross-device sync —
      has only ever been verified as source-correct + unit tested + (where mocked) pure-client
      correct, never against the live system end-to-end. Strongly recommend Dathan (or a CI
      environment with real egress) re-run at minimum: one full log→undo→delete cycle per pet,
      one CSV export, and one cross-device sync check, before treating v1.1 as fully done —
      **and specifically re-check AC-2.3a (the Log button fitting at 375×553) once D2 above is
      actually fixed**, since that's the one item this pass found still genuinely broken.

## 7. Test data

**No live `QA-test` rows exist for any pet** — confirmed directly this pass via SQL against the
live Supabase project (`select count(*) from feeds where logged_by ilike 'QA-test%' and
deleted_at is null` → `0`, checked both overall and broken out per pet). No test writes were
possible from this sandbox this pass (Node-side REST gets an immediate `403` before any row
could be created), and `QA_SKIP_REST_CLEANUP=1` was used to skip the now-unreachable cleanup
step in `helpers/fixtures.js`'s `beforeEach`. **No live-database cleanup is owed from this
pass.**

## 8. Sanity checks performed this pass

- **Console errors**: zero real console errors across 3 pets × {home, history} × {light,
  dark} = 12 combinations, re-checked directly via a fresh Playwright/CDP script this pass (not
  reused from a prior pass).
- **Unit tests**: 71/71 pass under both `America/Los_Angeles` and `UTC`, re-run directly this
  pass.
- **Migration state**: re-confirmed via direct SQL this pass — `pets` has exactly the 3 seeded
  rows in the right `sort_order`; `feeds.pet_id` has 0 nulls.
- **AC-5.2 / AC-11.1 / AC-11.2**: re-verified via direct SQL this pass (not merely re-read from
  a prior pass's evidence) — `anon` insert/update of `created_at` is rejected, `anon` delete is
  rejected and the row survives, and a soft-deleted row correctly persists with `deleted_at`
  set.
- **Full Playwright re-run**: all 5 projects (`rest-direct`, `source-checks`, `mobile-light`,
  `mobile-dark`, `desktop-light`), every spec file, not a delta run — 142 tests per browser
  project. This is how AC-2.3b's one transient failure in the desktop-light background run was
  caught as a Playwright trace-file I/O artifact from this session's own concurrent script
  activity (confirmed by an isolated re-run passing cleanly) rather than a real regression, and
  how D2's still-open status was caught in the first place — it would have been easy to only
  re-check the previously-FAILED items and miss that AC-2.3a (which fix round 1's own report
  had deferred re-capturing, not re-verifying) was still broken.

## 9. Ambiguities — status

Unchanged from fix round 1: all 5 original scaffolding-pass ambiguities remain resolved (see
prior passes' detail — heatmap grid formula, picker/header "same element," URL-rewrite
behavior, "pet didn't exist yet" heatmap wording, and the "first row"/"last row" doc typo). No
new ambiguities were found this pass beyond D2 in §4.

## Screenshot inventory (`tests/screenshots/`)

62 files total (57 from the prior pass + this pass's 6 fresh re-captures, net of the D3
regression test not itself adding a named screenshot). **Every previously-stale or
previously-missing file has now been captured fresh against this pass's build**:

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
