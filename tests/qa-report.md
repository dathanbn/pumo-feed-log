# Pumo Feed Log — QA report

## 1. Header

| Field | Value |
|---|---|
| Tested URL | `http://127.0.0.1:8080` (local static server: `python3 -m http.server 8080 --directory frontend`), serving a working tree whose `frontend/build.txt` is **byte-identical** to the real deploy's — see **Environment note** below |
| LIVE_URL (real deploy, confirmed live by the orchestrator; **not reachable from this sandbox** — see note) | `https://dathanbn.github.io/pumo-feed-log/` |
| `build.txt` | `2026-09-17T08:18:51.795Z` — reported by the orchestrator as the deployed value, and independently confirmed to match `frontend/build.txt` in this session's own working tree (`git log`: commit `944bba7`, "Build output: frontend, backend schema, GitHub Pages workflow, QA test suite"). Could not be fetched directly from `LIVE_URL` itself — see note. |
| Date / time tested | Initial pass: 2026-09-17, 08:13 UTC. Updated after `DEPLOYED:` message and defect fixes: 2026-09-17, 17:28 UTC (2026-09-17, 10:28 America/Los_Angeles) |
| Supabase project ref | `dufyzxtrhdcwrebagsfs` (from `SUPABASE_URL = https://dufyzxtrhdcwrebagsfs.supabase.co`, architecture.md §8), region `us-east-2`, status ACTIVE_HEALTHY |
| Browsers / devices | Chromium (machine-installed at `/opt/pw-browsers`, launched with `--no-sandbox`), emulating: `iPhone 13` (390×844) light and dark, plus 375×553 and 390×664 for AC-2.3, and 1440×900 desktop light. WebKit/real Safari and real Android Chrome were **not** available in this environment — see Dathan's checklist (§6) for the real-device pass. |
| Time zone | `America/Los_Angeles` for all tests (`timezoneId` in Playwright + client clock), matching contract.md/spec.md's `startOfLocalDay` behavior. No AC-7.2/8.3/8.4-style "must stay inside one local day" adjustment was needed since these tests use `page.clock.install`, not the sandbox's own wall clock. |
| Unit tests | `node --test tests/unit/logic.test.mjs`: **42/42 passing** under both `TZ=America/Los_Angeles` and `TZ=UTC`. |

### Environment note — why so much is BLOCKED, and how it was still verified

This sandbox's outbound network is allow-listed by host. Two hosts this suite needs are **not** on that allowlist:
- `*.supabase.co` — confirmed independently at three layers: `curl`, Node's `fetch`, and a real headless Chromium page's own `fetch()` — all fail with the proxy's `403 Host not in allowlist` before ever reaching Supabase.
- `*.github.io` (the real `LIVE_URL`, after the deploy) — **re-checked specifically for this update**, at two layers: `curl -sS https://dathanbn.github.io/pumo-feed-log/` → `curl: (56) CONNECT tunnel failed, response 403`; and a real Playwright/Chromium `page.goto('https://dathanbn.github.io/pumo-feed-log/build.txt')` → `net::ERR_TUNNEL_CONNECTION_FAILED`. Both fail at the proxy layer, identically to the Supabase case — **this sandbox cannot reach the real deployed app in a browser at all, regardless of the deploy's own health.** This is an environment limitation of the QA sandbox, not a defect in the app or the deploy.

Because of this, testing proceeded as follows, consistently applied below:
- **Any [QA] criterion whose proof requires a real round trip to the shared Supabase project, or to load the real `LIVE_URL` in a browser,** could not be executed by Playwright in this sandbox, before or after the deploy. These are marked **BLOCKED**, not FAIL — the app was never actually exercised against the real backend/real URL from here, so no pass/fail verdict on that real behavior is safe to give. Where the same UI/JS logic could be independently exercised against a *mocked* network response (`page.route(...).fulfill(...)`) or against the **local static server serving the exact deployed code** (see below), that is noted as supporting evidence.
- **AC-5.2, AC-11.1 and AC-11.2** (the direct-REST database-contract checks) do not depend on Playwright/Chromium or on `LIVE_URL` at all — only on reaching Supabase. Per the orchestrator's explicit instruction, these were verified through the **Supabase MCP tool** (`execute_sql`, prefixing each statement with `set role anon;` to run as the `anon`/publishable-key role). That channel **is** reachable from this environment, so these three criteria carry a genuine, fresh, first-party **PASS** — see §4 for the exact statements and results. This channel does not help with any criterion that needs a real browser driving the deployed frontend's JS, since it bypasses the app entirely.
- **The frontend source on disk in this working tree is confirmed byte-identical to the deployed build**: `frontend/build.txt` here reads `2026-09-17T08:18:51.795Z`, exactly matching the value the orchestrator reported for the live deploy, and it comes from the same commit (`944bba7`) that produced it. So for criteria that are pure UI/JS/CSS behavior with **no** dependency on reaching Supabase or on the specific hostname (e.g. the two defect re-tests below), re-running against the local static server is equivalent evidence to running against `LIVE_URL` itself, and was used accordingly. It is **not** equivalent evidence for anything that depends on the real network round trip to Supabase, which remains blocked either way.

A re-run of this same Playwright suite from an environment with real network access (CI, or the orchestrator's own environment) against the real `LIVE_URL` should turn the remaining BLOCKED rows into PASS with no test changes needed.

---

## 2. Summary counts

| Result | Count |
|---|---|
| PASS | 28 |
| FAIL | **0** |
| BLOCKED | 35 |
| UNIT-PASS | 1 (AC-7.3; AC-8.5 also has a UNIT sub-part, folded into its PASS row) |
| DATHAN | 2 (AC-1.1, AC-1.2) |
| **Total ACs (spec.md AC-1.1–AC-16.6)** | **66** |

**Both defects filed in the first pass (FAIL-1, the `[hidden]` CSS bug, and FAIL-2, the curly-apostrophe copy mismatch) are confirmed fixed** — see §4. The three ACs that were FAIL because of them (AC-14.2, AC-14.3, AC-16.5) move to BLOCKED rather than PASS, because each also has a separate, still-unverifiable real-network component (a real POST for AC-14.2/14.3; the S12 show-older-feeds state for AC-16.5) that this sandbox cannot reach either way.

Playwright test-level totals, final run (all projects: `mobile-light`, `mobile-dark`, `desktop-light`, `rest-direct`, `source-checks`; 4 workers, one full run, after the locator fix below and against the fixed frontend source): **169 passed, 74 failed, 48 timed out, 3 skipped** (294 total test executions). Every failure and timeout was individually triaged below; every one of them now traces to the sandbox network-egress limitation (Supabase and, since the deploy, `*.github.io` as well) — **zero remaining genuine app-defect failures**.

Unit tests: **42/42 passing**, `TZ=America/Los_Angeles` and `TZ=UTC` both clean (unchanged by this update).

---

## 3. Results table

`AC | Result | Evidence | Notes`

### F1. NFC tag opens the app
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-1.1 | DATHAN | — | Physical sticker check; see §6. |
| AC-1.2 | DATHAN | — | Physical tap-test on 4 household phones; see §6. |
| AC-1.3 | BLOCKED (environment) | `specs/01-app-load.spec.js`; direct `curl` and Playwright/Chromium `page.goto()` to `https://dathanbn.github.io/pumo-feed-log/` both fail at the sandbox proxy (`403`/`ERR_TUNNEL_CONNECTION_FAILED`) — see Environment note | The deploy is real and live (orchestrator-confirmed, `build.txt=2026-09-17T08:18:51.795Z`), but **this sandbox cannot reach `*.github.io` in a browser at all**, so QA could not independently load `LIVE_URL` to confirm "HTTPS, no login/interstitial, build.txt matches." Strong indirect evidence: the deploying agent's own Task 5 step 3 poll (`LIVE_URL/build.txt` matched the commit before declaring done) and the local working tree's `frontend/build.txt` matching the reported value exactly. **Needs one direct check from an environment that can reach `*.github.io`** — added to Dathan's checklist (§6). |

### F2. Home screen: last-fed headline and last 3 feeds
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-2.1 | PASS | `02-home-headline.spec.js` `AC-2.1a`, `AC-2.1b` | "Last fed 1h 40m ago" and "Last fed just now" both exact. |
| AC-2.2 | PASS | `02-home-headline.spec.js` `AC-2.2a`, `AC-2.2b` | 1-row and 2-row cases, newest-first order, "Today, h:mm AM/PM" + "by {name}" format all correct. |
| AC-2.3 | PASS | `02-home-headline.spec.js` `AC-2.3a`, `AC-2.3b`; `16-home-viewport-375x553-light.png`, `16-home-viewport-390x664-light.png` | Headline, counter, all 3 rows and Log button fit at 375×553 with zero scroll; Full history link visible at 390×664. |
| AC-2.4 | PASS | `02-home-headline.spec.js` `AC-2.4` | 5-minute clock jump via `page.clock`; headline updates within the 30 s tick. |
| AC-2.5 | BLOCKED | `02-home-headline.spec.js` `AC-2.5a` PASS (server-side `deleted_at=is.null` filter confirmed present on both the last-3 and today-count GETs), `AC-2.5b` BLOCKED (needs a real insert+delete+reload round trip) | Strong partial evidence: the app unconditionally asks the server to exclude deleted rows, so the remaining risk is narrow. |

### F3. One-tap logging
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-3.1 | BLOCKED | `03-logging.spec.js` `AC-3.1` | Needs a real POST + a real read-back; blocked by sandbox network egress. |
| AC-3.2 | BLOCKED | `03-logging.spec.js` `AC-3.2` | Could not obtain any real click-to-"Logged" timings in this sandbox (every trial fails at the network layer before "Logged" ever appears) — **no 5-trial timing table can be produced here**. Must be re-run against the real deploy. |

### F4. Button locks while saving; failed saves can be retried
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-4.1 | BLOCKED | `04-button-lock-retry.spec.js` `AC-4.1` | Needs a real POST (with artificial latency) plus a real row-count check. |
| AC-4.2 | BLOCKED | `04-button-lock-retry.spec.js` `AC-4.2` | Same. |
| AC-4.3 | BLOCKED | `AC-4.3a`/`b`/`c` BLOCKED (need a real successful retry to confirm "Logged"); `AC-4.3d` (timeout → not-saved) **PASSED** | The not-saved/warning-style behavior itself is confirmed for the timeout case; the "retry succeeds once the fault clears" half needs the real network. |
| AC-4.4 | BLOCKED | `04-button-lock-retry.spec.js` `AC-4.4` | Needs a real lost-response + retry + row-count check. |
| AC-4.5 | BLOCKED | `04-button-lock-retry.spec.js` `AC-4.5` | Same category. |

### F5. The server sets the timestamp
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-5.1 | BLOCKED | `05-server-timestamp.spec.js` `AC-5.1` (timed out) | Needs a real POST to inspect the server-assigned `created_at`. |
| AC-5.2 | **PASS** | Supabase MCP `execute_sql`, project `dufyzxtrhdcwrebagsfs`, run fresh this session (see §4 for the exact statements/results) | `set role anon; insert into public.feeds (logged_by, created_at) values (...)` → `42501 permission denied`. `set role anon; update public.feeds set created_at = ... where id = ...` → `42501 permission denied`. Playwright's own `rest-direct` project could not reach Supabase directly (same sandbox egress block), so this used the MCP fallback the orchestrator specified. |

### F6. Data reloads on page load and on focus
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-6.1 | PASS | `06-refresh-focus.spec.js` `AC-6.1` (all 3 projects) | Every API request observed used `cache: 'no-store'`; no response served from cache. |
| AC-6.2 | BLOCKED | `06-refresh-focus.spec.js` `AC-6.2` | Needs two real browser contexts with a real cross-device write in between. Also on Dathan's real-device checklist (§6), since this is the single most safety-critical behavior in the app. |
| AC-6.3 | PASS | `06-refresh-focus.spec.js` `AC-6.3` | Stale (>60 s) data triggers "Checking…" and a refetch before arming/logging, using mocked responses. |
| AC-6.4 | PASS | `06-refresh-focus.spec.js` `AC-6.4` | History screen reloads on focus regain. |

### F7. Recent-feed guard (2 hours)
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-7.1 | BLOCKED | `07-recent-guard.spec.js` `AC-7.1` | Needs a real second-tap write. |
| AC-7.2 | BLOCKED | `07-recent-guard.spec.js` `AC-7.2` | Same. |
| AC-7.3 | UNIT-PASS | `tests/unit/logic.test.mjs` (42/42, both time zones) | `guardState`'s 1h59m59s/exactly-2h00m00s boundary covered by the unit suite; reviewed and confirmed present. |
| AC-7.4 | PASS | `07-recent-guard.spec.js` `AC-7.4a`, `AC-7.4b` | Armed → guarded revert after 6 s, and immediately on page-hide, both confirmed. |
| AC-7.5 | BLOCKED | `07-recent-guard.spec.js` `AC-7.5` | Needs a real cross-phone write. |
| AC-7.6 | BLOCKED | `07-recent-guard.spec.js` `AC-7.6` | Needs a real write to age past the 2h boundary. |
| AC-7.7 | BLOCKED | `07-recent-guard.spec.js` `AC-7.7` (timed out) | Needs a real successful log first. |
| AC-7.8 | BLOCKED | `07-recent-guard.spec.js` `AC-7.8` (timed out) | Needs a real log + real undo. |

### F8. Daily count ("n of 4 today")
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-8.1 | PASS | `08-daily-guard.spec.js` `AC-8.1a`, `AC-8.1b` | |
| AC-8.2 | PASS | `08-daily-guard.spec.js` `AC-8.2a/b/c`; `08-home-counter-normal-3-light.png`, `08-home-counter-warning-4-light.png`, `08-home-counter-warning-5-light.png` | Warning style + icon + hidden ", daily limit reached" text at n≥4; keeps counting past 4. |
| AC-8.3 | BLOCKED | `08-daily-guard.spec.js` `AC-8.3` (timed out) | Needs a real second-tap write. |
| AC-8.4 | BLOCKED | `08-daily-guard.spec.js` `AC-8.4` (timed out) | Needs a real second-tap write. |
| AC-8.5 | PASS | `08-daily-guard.spec.js` `AC-8.5` (QA half: midnight reset within 30 s, mocked); `tests/unit/logic.test.mjs` (UNIT half: `startOfLocalDay` DST-day coverage, 42/42) | Both halves of this criterion pass. |

### F9. Undo right after logging
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-9.1 | BLOCKED | `09-undo.spec.js` `AC-9.1` (timed out) | Needs a real log to produce a real undo notice. |
| AC-9.2 | BLOCKED | `09-undo.spec.js` `AC-9.2` (timed out) | Needs a real soft-delete via Undo. |
| AC-9.3 | BLOCKED | `09-undo.spec.js` `AC-9.3` (timed out) | Same. |
| AC-9.4 | BLOCKED | `09-undo.spec.js` `AC-9.4` (timed out) | Same. |
| AC-9.5 | BLOCKED | `09-undo.spec.js` `AC-9.5` (timed out) | Same. |

All five of F9's real-network proofs are blocked, but the **UI/JS logic itself** was independently exercised end-to-end with a locally-synthesized (not real-network) successful POST/PATCH in `16-look-and-feel.spec.js` `AC-16.5l`, which passes: the undo notice appears with "Logged {time}" + Undo, Undo triggers a PATCH, a failed PATCH shows "Couldn't undo" with Retry/Dismiss, and Retry recovers. This is supporting evidence the app logic is correct, not a substitute for the real round-trip proof.

### F10. Delete any past feed, with one confirmation
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-10.1 | PASS | `10-delete.spec.js` `AC-10.1` | Delete control ≥44×44 with a screen-reader label, on every row. |
| AC-10.2 | PASS | `10-delete.spec.js` `AC-10.2`, `AC-10.2b` | Inline confirmation, exact `deleteConsequence` sentence, Cancel restores, Escape also cancels. |
| AC-10.3 | BLOCKED | `10-delete.spec.js` `AC-10.3` | Needs a real row + a real soft-delete. **Note:** the `10-home-delete-confirm-after-light.png` / `10-history-delete-confirm-after-light.png` screenshots (captured by `AC-16.5h`, see below) do **not** show this criterion's real success state — see that row's note. |
| AC-10.4 | PASS | `10-delete.spec.js` `AC-10.4`, all 3 projects, both in isolation and in the final full-suite run against the fixed frontend | An earlier pass saw a one-off Playwright strict-mode violation (two "Retry" buttons at once — the delete row's own, plus `#refresh-banner`'s, from the since-fixed FAIL-1 CSS defect leaking an extra interactive element into the page under specific leftover state from a preceding test in the same worker). Re-run in isolation and in the full suite after the FAIL-1 fix: clean on all 3 projects, no recurrence. |
| AC-10.5 | PASS | `10-delete.spec.js` `AC-10.5` | Only one row confirms at a time; opening a second cancels the first. |

### F11. Soft deletes only
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-11.1 | **PASS** | Supabase MCP `execute_sql`, fresh this session (§4) | Soft-deleted row confirmed still present with `deleted_at` set, via `deleted_at=not.is.null`-equivalent query. |
| AC-11.2 | **PASS** | Supabase MCP `execute_sql`, fresh this session (§4) | `set role anon; delete from public.feeds where id = ...` → `42501 permission denied`; row still exists afterward. |
| AC-11.3 | PASS | `11-soft-delete-source.spec.js` (`source-checks` project) | Grep of `frontend/js/` confirms no `DELETE` HTTP call anywhere, and Undo/Delete both route through the same `softDeleteFeed`. |

### F12. Full history
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-12.1 | PASS | `12-history.spec.js` `AC-12.1a`, `AC-12.1b/12.2` | Link opens `history.html`; grouped by local day with correct headings and newest-first ordering. |
| AC-12.2 | PASS | `12-history.spec.js` `AC-12.1b/12.2` | Day-heading counts ("4 feeds"/"1 feed") correct. |
| AC-12.3 | BLOCKED | `12-history.spec.js` `AC-12.3` | Needs 101 real rows via REST POST (tasks.md §2 Data hygiene item), then a real paged GET. |
| AC-12.4 | BLOCKED | `12-history.spec.js` `AC-12.4a` BLOCKED (needs a real insert+delete); `AC-12.4b` **PASSED** (back link returns to home with fresh data) | |

### F13. Shared backend (Supabase)
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-13.1 | BLOCKED | `13-shared-backend.spec.js` `AC-13.1` | Needs two real contexts + a real write. |
| AC-13.2 | BLOCKED | `13-shared-backend.spec.js` `AC-13.2a` (needs real writes), `AC-13.2b` (the localStorage-keys-audit test also performs a real log, so it hit the same network block before completing) | |

### F14. "by {name}" without logins
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-14.1 | BLOCKED | `14-name.spec.js` `AC-14.1` (timed out) | Needs a real POST to confirm `logged_by: null`. |
| AC-14.2 | BLOCKED | `14-name.spec.js` `AC-14.2` (now times out at the real-POST step, not at the card-hiding assertion); `FAIL-1 re-test` **PASSED** (see §4) | The FAIL-1 CSS defect (name card staying visible/interactive after Save) is **confirmed fixed**: the card-hiding assertion now passes immediately (no real network involved in that step), and computed style/`hidden`-attribute were directly re-verified (`hasHiddenAttr: true, display: "none"`). The remaining, still-BLOCKED half of this criterion — "every later log sends `logged_by: 'Sam'`" — needs a real POST, which this sandbox still cannot reach. |
| AC-14.3 | BLOCKED | `14-name.spec.js` `AC-14.3` (now times out at the real-POST step, not at the card-hiding assertion) | Same fix, same remaining real-network gap, after Skip instead of Save. |
| AC-14.4 | PASS | `14-name.spec.js` `AC-14.4`; `14-home-footer-no-name-light.png`, `14-home-footer-with-name-light.png` | Both footer copy variants exact; footer reopens the card pre-filled with the current name. |
| AC-14.5 | PASS | `14-name.spec.js` `AC-14.5` | `<img src=x onerror=alert(1)>` renders as literal text; no `alert()` fires; not present as raw injected markup in the DOM. |
| AC-14.6 | BLOCKED | `14-name.spec.js` `AC-14.6` (timed out) | The app was observed to load and reach a ready "Log a feed" state with `localStorage` throwing, and threw no page errors — but the real-POST half of this test (confirming the feed still logs and shows "by Someone") could not complete. |

### F15. No access control (intentional)
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-15.1 | BLOCKED | `15-no-access-control.spec.js` `AC-15.1` (timed out — needs a real full log→undo→delete cycle); `AC-15.1b` **PASSED** (history reachable/usable with no stored data) | No login/PIN/account screen exists anywhere in the markup or flow, confirmed by every other test in this suite (none of them ever encounter one); only the real end-to-end action chain is blocked. |

### F16. Look and feel
| AC | Result | Evidence | Notes |
|---|---|---|---|
| AC-16.1 | PASS | `16-look-and-feel.spec.js` `AC-16.1` | Header shows "Pumo" + cat-head avatar fallback (`PUMO_PHOTO_URL` unset). |
| AC-16.2 | PASS | `16-look-and-feel.spec.js` `AC-16.2` | Follows emulated color scheme, restyles without reload. |
| AC-16.3 | PASS | `16-look-and-feel.spec.js` `AC-16.3`; `16-home-desktop-1440-light.png` | Single column, centered, ≤440px at 1440×900. |
| AC-16.4 | PASS | `16-look-and-feel.spec.js` `AC-16.4` | Tab title "Pumo Feed Log", favicon present, 180×180 opaque apple-touch-icon linked. |
| AC-16.5 | BLOCKED | `16-look-and-feel.spec.js` `AC-16.5a`–`AC-16.5l` (all 14 states now captured and correct, including `AC-16.5f2`/S11); `FAIL-2 re-test` **PASSED** (see §4); `AC-16.5g` (S12) still BLOCKED | S1–S11, S13 and the guarded/armed/saving/logged/undo/delete-confirm states all match design.md §6 word for word, with screenshots (see §7 inventory). The FAIL-2 curly-apostrophe defect is **confirmed fixed**: `AC-16.5f2`'s strict word-for-word copy assertion for S11 now passes on all 3 projects, and a dedicated re-test with `afterFix: true` captured fresh evidence. **S12 (show-older-feeds error) still could not be reached** — it needs 100+ real rows via REST to make "Show older feeds" appear before it can be faulted, and that remains blocked by the sandbox network limit; screenshot still missing. **Mislabeled-evidence note (flagged in review):** `AC-16.5h`'s "delete-confirm … after" screenshots (`10-home-delete-confirm-after-light.png`, `10-history-delete-confirm-after-light.png`) click Delete's confirm button, which sends a real PATCH that this sandbox's proxy blocks (403) — so both screenshots actually show the **failed-delete state** ("Couldn't delete." + Retry/Cancel), not a successful inline delete. They are accurate evidence for the *failed-delete* look (duplicating `10-home-delete-failed-light.png`), not for AC-10.3's real success path, which remains genuinely untested here (see that row). |
| AC-16.6 | PASS | `16-look-and-feel.spec.js` `AC-16.6a` (axe, home, light+dark), `AC-16.6b` (axe, history, light+dark), `AC-16.6c` (keyboard focus ring) — all clean, no serious/critical violations | `AC-16.6d` (tap-target boundingBox spot-check, a tasks.md §2 methodology item rather than its own spec.md AC) timed out on the Undo-button measurement specifically, because it needs a real log first; the Log-button-height and Delete-control-size checks it also covers are already independently confirmed via AC-10.1 and other passing tests. |

---

## 4. Defects

**Both defects below were filed against the frontend agent after the first QA pass, fixed by the frontend agent before the deploy in this update's message, and are now independently re-verified as fixed** by QA — see each defect's "Re-test result." No open defects remain.

### FAIL-1 (major, FIXED) — `[hidden]` elements stay visible and interactive because of a CSS specificity/origin bug

**Where:** `frontend/css/styles.css` — `.banner` (line 122), `.undo-notice` (line 502), `.name-card` (line 592), `.older-error` (line 712). Confirmed there is **no `[hidden]` rule anywhere in `styles.css`** (`grep -n '\[hidden\]' frontend/css/styles.css` → no matches).

**Repro:**
1. Load the app fresh (no stored name), let the name card render (`#name-card`, class `name-card`).
2. Fill the name field, click Save (or click Skip). The app's own JS correctly sets the `hidden` attribute on `#name-card` at this point (confirmed by reading `frontend/js/home.js`/`ui.js` — the JS-level state is correct).
3. Inspect the DOM/computed style: `#name-card` still computes `display: flex`, not `display: none`, and is still visible on screen and reachable by keyboard/screen reader.

**Expected:** Once an element carries the `hidden` attribute, it should not render or be reachable by assistive tech (the HTML/UA-stylesheet contract: `[hidden] { display: none }`).

**Actual:** `.name-card { … display: flex; … }` in `styles.css` is an unconditional author-origin rule with no `[hidden]` override. Per CSS cascade rules, author-origin beats the UA stylesheet's `[hidden]{display:none}` regardless of specificity, so the element keeps rendering. The same pattern affects `.banner` (S4 refresh banner — stays visible/interactive after the app hides it, confirmed independently via the AC-10.4 `mobile-dark` collision above), `.undo-notice` and `.older-error`.

**Screenshot:** `tests/screenshots/14-home-name-card-light.png` shows the card in its normal (correctly-visible) state; the clearest **automated** evidence of the original defect was the failing assertions themselves (`AC-14.2`/`AC-14.3` resolving 1 element after Save/Skip instead of 0, and the `AC-10.4` `mobile-dark` strict-mode violation). See the Re-test result below for the fixed-state screenshot.

**Suggested fix (applied):** the frontend agent added a global rule to `frontend/css/styles.css` (line 83): `[hidden] { display: none !important; }`, with a comment explaining the author-origin-vs-UA-stylesheet cascade issue.

**Severity:** major — this was a real, user-visible defect (stale/irrelevant UI staying on screen and interactive, e.g. the name card re-appearing under the Log button after it's supposed to be gone, or the "Retry" from a resolved refresh-banner error still sitting on the page), independent of the sandbox network issue, and directly caused AC-14.2/AC-14.3 to fail plus AC-10.4's one-off flake.

**Re-test result (FIXED, confirmed this update):**
- Direct DOM/computed-style inspection after Save: `{ hasHiddenAttr: true, display: "none" }` (was `display: "flex"` before the fix).
- New dedicated test `FAIL-1 re-test` (`specs/14-name.spec.js`) **passes**: `nameCardHeading(page)` resolves to 0 elements after Save, matching the real fixed behavior. Screenshot: `tests/screenshots/14-home-name-card-hidden-light-after-fix.png`.
- `AC-14.2`/`AC-14.3` no longer fail on this assertion — they now proceed past it and only time out later, at the still-unrelated, still-blocked real-POST step (see §3).
- `AC-10.4` re-run clean on all 3 projects, isolated and in the full suite (no more stray "Retry" collision).
- Also fixed a second, unrelated bug this surfaced in QA's **own** test suite: `nameCardHeading`'s locator had a `.or(getByText(...))` fallback that matched DOM text regardless of `display:none`, which would have silently kept `toHaveCount(0)` failing even after the app's fix. Corrected to a single `getByRole('heading', { name: /regex/ })` query, which is both apostrophe-tolerant and correctly hidden-aware (`tests/e2e/helpers/selectors.js`).

### FAIL-2 (minor/cosmetic, FIXED) — curly apostrophe used where the spec requires a straight one

**Where:**
- `frontend/index.html:26` — `<p class="tagline">Don&rsquo;t trust the meows.</p>`
- `frontend/index.html:56` — `<h2 class="name-card__title">Who&rsquo;s feeding Pumo?</h2>`
- `frontend/js/ui.js:45` — `historyLoadErrorTitle: 'Can’t load history.'` (literal U+2019 curly apostrophe)

**Repro:** Trigger S11 (history load error: `net.abortRequests(page, {methodFilter:'GET'})` then load `history.html`) and read the error panel's text, or inspect the three lines above directly.

**Expected:** `docs/design.md` §5's copy table and prose consistently use the straight apostrophe (U+0027), e.g. "Can't load history." — and tasks.md §2 item 4 requires the app's copy to match design.md §5 word for word.

**Actual (before fix):** The app rendered a curly apostrophe (U+2019 / `&rsquo;`) in these three places instead.

**Screenshot:** `tests/screenshots/11-history-load-error-light.png` (original, quote-tolerant capture) and `tests/screenshots/11-history-load-error-light-after-fix.png` (new, strict-copy-passing capture).

**Suggested fix (applied):** the frontend agent replaced `&rsquo;`/U+2019 with a plain `'` (U+0027) in all three locations (`frontend/index.html:26,56`, `frontend/js/ui.js:45`) — confirmed by re-reading the source directly.

**Severity:** minor/cosmetic — purely a copy-fidelity mismatch against the design doc; did not affect functionality, layout or accessibility.

**Re-test result (FIXED, confirmed this update):** `grep -n "rsquo\|’" frontend/index.html frontend/js/ui.js` now returns no matches. `AC-16.5f2`'s strict word-for-word assertion (`getByText("Can't load history.")`, straight apostrophe, no tolerant fallback) **passes** on all 3 projects. New dedicated test `FAIL-2 re-test` (`specs/16-look-and-feel.spec.js`) also passes, with its own `-after-fix` screenshot.

---

## 5. Build notes

No separate written hand-off document from the frontend agent was available to the QA agent to copy verbatim (no `docs/`-adjacent hand-off file with preflight curl outputs was found in the repo). What could be independently confirmed by QA:
- `docs/architecture.md` §8 setup values are filled in: `SUPABASE_SETUP_PATH=mcp`, project `dufyzxtrhdcwrebagsfs` (region `us-east-2`, ACTIVE_HEALTHY), `HOSTING=github-pages`, `GITHUB_REPO=https://github.com/dathanbn/pumo-feed-log`, `LIVE_URL=https://dathanbn.github.io/pumo-feed-log/`, `PUMO_PHOTO=none`, `CUSTOM_ICON=none`.
- **Update:** the build has since been committed and deployed. `git log` in this working tree now shows commit `944bba7` ("Build output: frontend, backend schema, GitHub Pages workflow, QA test suite"), and `frontend/build.txt` reads `2026-09-17T08:18:51.795Z`, matching the orchestrator's `DEPLOYED:` message exactly. The frontend agent also fixed both defects filed in the first QA pass (FAIL-1, FAIL-2 — see §4) as part of this build.
- `backend/schema.sql` exists; not independently byte-diffed against contract.md §2 in this pass (out of QA's ownership boundary to modify, and the schema's actual behavior was independently verified live via the MCP grant/RLS checks in §4/AC-5.2/11.1/11.2, which is the stronger proof).
- QA could not independently confirm `LIVE_URL` itself serves correctly, because this sandbox cannot reach `*.github.io` at all (see Environment note in §1) — this is an environment limitation of the QA sandbox, not something the build notes can resolve.

---

## 6. Dathan's post-deploy checklist (real phones)

These cannot be done by the QA agent — no physical phones or NFC hardware in this environment, and (new, since the deploy) this sandbox's network policy blocks it from even loading `LIVE_URL` in a browser. Please do these after (or alongside) reading this report:

- [ ] **AC-1.3 (new — QA could not reach `LIVE_URL` at all from its sandbox)** — from a normal computer or phone, open `https://dathanbn.github.io/pumo-feed-log/` and confirm: it loads over HTTPS with no login/interstitial page, and `https://dathanbn.github.io/pumo-feed-log/build.txt` shows `2026-09-17T08:18:51.795Z`. This is expected to just work — QA's local copy of the exact same build (verified byte-identical by `build.txt`) behaves correctly — but a from-the-real-URL confirmation is still worth 10 seconds, since QA's sandbox genuinely could not check the live host itself (see §1 Environment note).
- [ ] **AC-1.1** — confirm the NTAG213 sticker holds exactly one NDEF URL record containing LIVE_URL (https, ≤100 characters). (architecture.md §7 step 9)
- [ ] **AC-1.2** — with the sticker in its final spot, tap it 3 of 3 times on every household phone: an unlocked Android phone with NFC on should open LIVE_URL directly; an awake, unlocked iPhone XS+ should show the system banner, and tapping it opens LIVE_URL.
- [ ] **AC-6.2 on real hardware** — on a real iPhone (Safari) and a real Android phone (Chrome): open the app, switch apps (or lock/unlock), log a feed from a different phone, come back, and confirm the first phone's feed shows within 2 s with no manual reload.
- [ ] Set a name on each of the 4 household phones (F14) and confirm it appears in the footer and on new feed rows.
- [ ] Confirm dark mode looks right on each phone (matching the system dark-mode setting).
- [ ] Do one real feed, one Undo, and one Delete end to end on a real phone, and confirm it disappears/reappears as expected across a second phone.

Everything else in this report (§3) that's marked BLOCKED is a QA-sandbox network limitation, not a known app problem — the app's own logic for all of it was exercised and confirmed correct wherever it could be tested locally (mocked network or the byte-identical local build). None of it requires a special Dathan action beyond normal use; it's listed as BLOCKED purely because QA itself could not independently produce real-network evidence from this sandbox.

---

## 7. Test data

- **Real Supabase writes this session:** one `logged_by: 'QA-test'` row was inserted via the Supabase MCP tool (`execute_sql`, `set role anon;`) to obtain fresh, first-party evidence for AC-5.2/AC-11.1/AC-11.2 (id `679f291b-cb6f-417a-9789-1f875072b746`, inserted then soft-deleted in the same verification pass — see §4). No other real writes reached Supabase: every Playwright-driven real-network attempt (POST/PATCH/GET against `dufyzxtrhdcwrebagsfs.supabase.co`) failed at the sandbox's proxy layer before reaching Supabase at all, so none of those attempts could have left live data behind.
- **Confirmed clean, this session, via MCP:**
  - `select count(*) from public.feeds where logged_by ilike 'QA-test%' and deleted_at is null;` → **0**
  - `select count(*) from public.feeds where logged_by ilike 'Build-test%' and deleted_at is null;` → **0**
- **No live `QA-test` or `Build-test` rows remain** in the shared Supabase project, reconfirmed via MCP as of 2026-09-17 17:28 UTC (both the initial pass and this update's re-testing produced zero real Supabase writes outside the one MCP-based row already noted above, since every Playwright-driven real-network attempt — including the second full-suite run against the fixed frontend — still failed at the sandbox's proxy layer before reaching Supabase).
- Optional cleanup SQL (architecture.md §9), for reference, not needed right now since the count is already zero: `delete from public.feeds where logged_by in ('Build-test', 'QA-test');` (dashboard/service-role only — the app itself can never hard-delete).

---

## Screenshot inventory (`tests/screenshots/`, 43 files)

S1 empty (light/dark), S2 loading, 3-feeds home (light/dark), S3 load error (light/dark), S4 refresh banner, S5 not-saved (light/dark), guarded-resting (light/dark), armed-after (light/dark), armed-combined, saving, logged+undo-notice, undo-notice before/after, undo-failed, counter normal/warning-4/warning-5, S9 history-loading, S10 history-empty, S11 history-load-error (original + `-after-fix`), delete-confirm before/after ×2 (home + history) — **⚠ both "after" shots actually show the failed-delete state, not a successful delete; see the AC-16.5/AC-10.3 notes above** — delete-failed, S13 paused-hint, name-card, name-card-hidden (`-after-fix`), footer no-name/with-name, history-grouped (light/dark), desktop 1440, viewport 375×553 and 390×664.

**Still missing from the minimum set:** S12 (show-older-feeds error) — BLOCKED, needs 100+ real rows via REST to reach the state at all (see AC-16.5/AC-12.3 rows above). This remains blocked by the sandbox network limitation even after the deploy, since it needs a real Supabase round trip, not just the real URL. Will be captured on a re-run from an environment with real network access.
