# Pumo Feed Log: v1 spec

Status: approved by Dathan. The build runs unattended from `docs/` and nobody will be asked anything during it. If these files seem to disagree: `contract.md` wins on data, constants and formatting rules, `design.md` wins on visuals and copy, and this file wins on behavior.

**v1.1 note:** this spec now covers three pets (F17), a feeding heatmap (F18) and CSV export (F19), on top of everything v1 shipped. Every "the app"/"Pumo" reference elsewhere in this doc still applies — it just now applies per-pet, scoped by whichever pet is currently selected (F17). Where a feature is genuinely Pumo-specific (there is none left after F17), it says so explicitly.

## 1. Goal

Pumo begs for food whether or not he has eaten, so the four people in the household can't tell if he has already been fed. Pumo Feed Log fixes that with one NFC sticker on his food container. Tap it with any phone and a small web page opens. The page shows when Pumo was last fed, how many times he has eaten today, and a big button that logs a feed in one tap. All four phones read and write one shared Supabase database, so everyone sees the same answer and nobody feeds him "just in case." **As of v1.1**, the same app also covers Zuumi (cat) and Banh Mi (dog), each with their own sticker, own log and own guards — see F17.

## 2. Target user

- **Primary:** the 4 people in Dathan's household, each with their own phone (assume a mix of iPhone and Android). Typical use: standing at the food container, scoop in hand, a 5-second tap and glance. Most visits are "has he eaten?", and some are "I'm feeding him now."
- **Occasional:** a cat-sitter or guest who has never seen the app. They need zero setup: no account, no install, no PIN.
- **Not for:** vets, or anyone who wants accounts, stats or reminders. (Multiple pets *are* in scope as of v1.1 — see F17 — but the household stays small and fixed: adding a pet is a manual dashboard step, not a self-serve feature.)

## 3. Terms

- **Feed:** a row in `feeds` whose `deleted_at` is null, always for exactly one **pet**.
- **Deleted feed:** a row whose `deleted_at` is not null. The app never shows it or counts it.
- **Pet:** a row in `pets` — Pumo, Zuumi or Banh Mi (contract.md §1). Every screen shows exactly one pet's data at a time, chosen by the URL (F17).
- **Feed day (was "Today" pre-v1.1):** from 3:00 AM local time on the phone doing the viewing, up to 2:59:59 AM the next day. **The reset moved from midnight to 3 AM in v1.1** because the household sometimes feeds pets late at night, and midnight was resetting the count mid-evening. `startOfFeedDay`/`feedDayKey` in contract.md §7.6 are the exact rule; "Today" in the rest of this document (headings, counter) means the *current feed day*, not the calendar day.
- **Recent guard:** the most recent feed was less than `RECENT_FEED_GUARD_MS` (2 hours) ago.
- **Daily guard:** today's (this feed day's) feed count for the selected pet is already at or above `DAILY_FEED_TARGET` (4).
- **Guarded:** at least one guard applies.
- **Armed:** the Log button after one tap while guarded. It is waiting for a confirming second tap.
- **LIVE_URL:** the deployed app URL from the setup values table in `architecture.md`. As of v1.1 this is Pumo's URL specifically (F17's default pet); Zuumi's and Banh Mi's URLs are LIVE_URL plus a query string (F17, architecture.md §10).
- Constant names (`RECENT_FEED_GUARD_MS` and so on) are defined in `contract.md` §7.

## 4. V1 features and acceptance criteria

Each criterion is tagged with who verifies it:
- **[QA]** The QA agent, in a real browser, against the real Supabase project and the real deploy.
- **[UNIT]** A unit test in `tests/unit/`.
- **[DATHAN]** A physical check on real phones after deploy. The QA agent lists these in its report because it can't do them.

For time-based criteria, the QA agent may move the browser clock forward relative to the real, server-assigned `created_at`. That counts as waiting.

### F1. NFC tag opens the app
- **AC-1.1 [DATHAN]** The NTAG213 sticker holds exactly one NDEF URL record containing LIVE_URL (https, 100 characters or fewer).
- **AC-1.2 [DATHAN]** With the sticker in its final spot, tapping works on every household phone, 3 of 3 tries each. An unlocked Android phone with NFC on opens LIVE_URL in the browser. An awake, unlocked iPhone XS or newer shows the system banner, and tapping the banner opens LIVE_URL.
- **AC-1.3 [QA]** LIVE_URL serves the app over HTTPS with no login or interstitial page, and `LIVE_URL/build.txt` matches the latest build.

### F2. Home screen: last-fed headline and last 3 feeds
- **AC-2.1 [QA]** With at least one feed, the headline reads "Last fed {relative}", formatted per `contract.md` §7.3 and based on the most recent feed. A feed 1h 40m old shows "Last fed 1h 40m ago". A feed 30 s old shows "Last fed just now".
- **AC-2.2 [QA]** Below the headline are up to 3 of the most recent feeds, newest first. Each shows a day and time label plus "by {name}", for example "Today, 7:42 AM" and "by Sam". With 1 or 2 feeds, it shows 1 or 2 rows and no placeholders.
- **AC-2.3 [QA]** Nothing needs scrolling. At a 375×553 CSS px viewport (iPhone SE with Safari toolbars), the headline, daily counter, all 3 rows and the Log button are fully visible. At 390×664 (iPhone 13 with Safari toolbars), the "Full history" link is also visible.
- **AC-2.4 [QA]** Relative times update without a reload. With the page open and the clock advanced 5 minutes, the headline changes within 30 s.
- **AC-2.5 [QA]** Deleted feeds never affect the headline, the recent list, the counter or either guard.

### F3. One-tap logging
- **AC-3.1 [QA]** With no guard active, one tap on "Log a feed" creates exactly one row. There is no dialog, field or extra step.
- **AC-3.2 [QA]** Within 1 s of the tap, the button reads "Logged", the headline reads "Last fed just now" and the new feed is at the top of the recent list. Pass condition: 5 trials in a row, each under 1 s, on the QA environment's normal connection.

### F4. Button locks while saving, and failed saves can be retried
- **AC-4.1 [QA]** From the tap until the server responds, the button is disabled and reads "Saving…". With 3 s of artificial latency on the POST, tapping 5 times quickly creates exactly 1 row.
- **AC-4.2 [QA]** "Logged" appears only after the server confirms, meaning a 201 or the duplicate-id 409 described in `contract.md` §6.C. While the POST is held pending, "Logged" never appears.
- **AC-4.3 [QA]** If the POST fails, the button shows "Not saved, tap to retry" in warning style, no new feed appears and no undo notice appears. Failure means any of: offline, request aborted, HTTP 5xx, or no response within `REQUEST_TIMEOUT_MS`. Tapping the button resends the save, and on success it shows "Logged".
- **AC-4.4 [QA]** Suppose the POST reaches the database but the response is lost. Tapping "Not saved, tap to retry" still leaves exactly one row, because the retry reuses the same `id`.
- **AC-4.5 [QA]** A retry is not guarded again. If a confirmed (armed, then tapped) save fails, one tap on "Not saved, tap to retry" resends it.

### F5. The server sets the timestamp
- **AC-5.1 [QA]** The POST body never contains `created_at`. With the browser clock set 3 hours ahead, a logged feed's `created_at` is within 5 s of real time.
- **AC-5.2 [QA]** The database itself rejects a direct REST POST that tries to set `created_at` (401 or 403, code `42501`). This is not just app behavior. **(v1.2 update: a PATCH is no longer categorically rejected — correcting an existing feed's time is now a supported operation, F21/contract.md §6.H. What's still rejected at the database level is a PATCH that sets `created_at` more than 5 minutes in the future, code `23514` — see AC-21.4 and contract.md §3/§6's "calls that must fail" table.)**

### F6. Data reloads on page load and when the tab regains focus
- **AC-6.1 [QA]** Every page load fetches fresh data. All API requests use `cache: 'no-store'`, and no API response comes from cache.
- **AC-6.2 [QA]** Device A has the home screen open and then goes hidden. Device B logs a feed. When A becomes visible again (`visibilitychange`, `focus`, or `pageshow` from the back-forward cache), A shows B's feed within 2 s without a manual reload.
- **AC-6.3 [QA]** If the data on screen is more than `STALE_AFTER_MS` (60 s) old when "Log a feed" is tapped, the app refetches first (the button reads "Checking…") and applies the guards to the fresh data. Example: A loaded 5 minutes ago with no recent feed, B logged 1 minute ago, and A taps once. A arms instead of logging.
- **AC-6.4 [QA]** The history screen also reloads when it regains focus.

### F7. Recent-feed guard (2 hours)
- **AC-7.1 [QA]** Last feed 1h 55m ago: on open, the button uses the guarded style (outlined, label "Log a feed"). The first tap writes nothing and changes the button in place to "Fed 1h 55m ago — log another?". A second tap within `ARM_TIMEOUT_MS` (6 s) writes exactly one row. No dialog appears at any point.
- **AC-7.2 [QA]** Last feed 2h 05m ago, fewer than 4 feeds today: the button uses the normal filled style, and one tap writes a row.
- **AC-7.3 [UNIT]** The recent guard applies only when `now − lastFeed.created_at < 7,200,000 ms`. At 1h 59m 59s it applies. At exactly 2h 00m 00s it does not.
- **AC-7.4 [QA]** An armed button with no second tap goes back to the guarded style after 6 s, or immediately when the page is hidden. A tap after that arms it again and does not log.
- **AC-7.5 [QA]** The guard counts feeds from every phone. A feed logged on B guards A after A refreshes.
- **AC-7.6 [QA]** If the page stays open while the last feed passes the 2-hour mark, the button returns to the normal style within 30 s.
- **AC-7.7 [QA]** Right after a successful log, the next tap arms instead of logging, because the feed just logged triggers the guard.
- **AC-7.8 [QA]** Undoing or deleting the only feed from the last 2 hours removes the recent guard.

### F8. Daily count ("3 of 4 today"), fully enforced
- **AC-8.1 [QA]** The counter reads "{n} of 4 today". n is the number of feeds *for the selected pet* whose `created_at` is at or after the start of the current feed day (3:00 AM local, contract.md §7.6 — **not midnight, as of v1.1**), local time on the viewing phone. With no feeds today it reads "0 of 4 today".
- **AC-8.2 [QA]** When n is 4 or more, the counter uses the warning style: warning color, a warning icon and screen-reader text ", daily limit reached". It keeps counting past 4, so a fifth feed shows "5 of 4 today". When n is 3 or less, it uses the normal style.
- **AC-8.3 [QA]** With n = 4 and the last feed more than 2 hours old, the first tap arms the button as "4 of 4 today — log another?". The second tap logs, and the counter then reads "5 of 4 today".
- **AC-8.4 [QA]** When both guards apply, there is one combined armed label, for example "Fed 40m ago, 4 of 4 today — log another?". Logging takes exactly 2 taps in total.
- **AC-8.5 [QA]** The count resets at 3:00 AM local (**not midnight, as of v1.1**). With the clock at 03:00:30, the counter reads "0 of 4 today" and no daily guard applies. The recent guard can still apply, for example to a 1:30 AM feed. A page left open across the 3 AM boundary resets within 30 s. A feed logged at 1:30 AM (after midnight, before 3 AM) counts toward the *previous* feed day, and its home/history label reads "Yesterday, 1:30 AM" once the calendar date has turned over. **[UNIT]** The 3 AM boundary is correct in `America/Los_Angeles`, including the DST days 2026-03-08 and 2026-11-01, and including a feed logged between midnight and 3 AM on each.

### F9. Undo right after logging
- **AC-9.1 [QA]** After "Logged", an undo notice appears under the button reading "Logged {time}" with an Undo button. It stays for `UNDO_WINDOW_MS` (10 s, give or take 0.5 s) and then disappears.
- **AC-9.2 [QA]** Tapping Undo within the window asks for no confirmation. It sets that row's `deleted_at` (the row stays in the database). Within 1 s the feed disappears from the home screen, and the headline, counter and guard recalculate. The notice reads "Feed removed" for 3 s.
- **AC-9.3 [QA]** Once the window has passed, Undo is gone, and the feed can only be removed through Delete with confirmation (F10).
- **AC-9.4 [QA]** If the undo fails, the notice reads "Couldn't undo" with Retry and Dismiss. It stays until a retry succeeds or it is dismissed, and the feed stays visible in the meantime.
- **AC-9.5 [QA]** Logging again while the notice is showing replaces it. Undo only ever applies to this phone's most recent log.

### F10. Delete any past feed, with one confirmation
- **AC-10.1 [QA]** Every row in the home screen's recent list and in history has a Delete control. It is at least 44×44 CSS px and has a screen-reader label.
- **AC-10.2 [QA]** Tapping Delete replaces that row in place with a confirmation. The confirmation states what will change, following the rules in `contract.md` §7.5, and offers Cancel and Delete. Example with feeds today at 7:42 AM and 3:10 AM, deleting 7:42: "Delete the 7:42 AM feed? Last feed will then show 3:10 AM. Today's count goes from 2 to 1." Nothing is written before the user confirms, and Cancel restores the row.
- **AC-10.3 [QA]** Confirming sets `deleted_at`. Within 1 s the feed disappears from the current screen and the headline, counter and guard update. Other screens and devices drop it on their next load or focus.
- **AC-10.4 [QA]** If the delete fails, the row reads "Couldn't delete." with Retry and Cancel, and the feed stays.
- **AC-10.5 [QA]** Only one row can be confirming at a time. Opening a second confirmation cancels the first.

### F11. Soft deletes only
- **AC-11.1 [QA]** After an undo or a delete, the row still exists in the database with a non-null `deleted_at`. Check with the REST query `deleted_at=not.is.null`.
- **AC-11.2 [QA]** A direct REST `DELETE` sent with the publishable key is rejected (401 or 403, code `42501`), and the row still exists.
- **AC-11.3 [QA]** `frontend/` contains no `DELETE` HTTP calls. Undo and Delete both call the same `softDeleteFeed` function.

### F12. Full history
- **AC-12.1 [QA]** The "Full history" link on the home screen opens `history.html`. Feeds are grouped by local day under headings "Today", "Yesterday", then dates like "Monday, September 14" (with the year added if it isn't the current year). The newest feeds come first, both within each day and across days. Each row shows the time, "by {name}" and Delete.
- **AC-12.2 [QA]** Each day heading shows that day's count, for example "4 feeds" or "1 feed".
- **AC-12.3 [QA]** The first `HISTORY_PAGE_SIZE` (100) feeds load. If exactly 100 come back, a "Show older feeds" button loads the next 100 and merges them into the existing day groups. When a page returns fewer than 100, the button is hidden.
- **AC-12.4 [QA]** Deleted feeds are not listed. The back link returns to the home screen, which shows fresh data.

### F13. Shared backend (Supabase)
- **AC-13.1 [QA]** A feed logged in browser context A shows up in context B (a separate profile with no shared storage) the next time B loads.
- **AC-13.2 [QA]** Clearing all site data on A and reloading still shows every feed. The only localStorage keys the app ever writes are `pumo.loggerName` and `pumo.namePromptDone`.

### F14. "by {name}" without logins
- **AC-14.1 [QA]** On a phone with nothing stored, a "Who's feeding Pumo?" card appears below the Log button with a text field, Save and Skip. It never blocks logging. Logging before answering sends `logged_by: null`.
- **AC-14.2 [QA]** Saving "Sam" stores it and hides the card. Every later log from that phone sends `logged_by: "Sam"`, and those feeds show "by Sam" on every device. Names are trimmed, repeated spaces are collapsed, the maximum is 20 characters, and Save is disabled while the field is empty.
- **AC-14.3 [QA]** After Skip, the card never appears again on that phone, and its feeds show "by Someone".
- **AC-14.4 [QA]** The footer reads "Logging as Sam · Change", or "No name on this phone · Set name", and reopens the card. A changed name applies only to future logs.
- **AC-14.5 [QA]** Names display as plain text. A name like `<img src=x onerror=alert(1)>` shows literally and runs no script.
- **AC-14.6 [QA]** If localStorage throws (for example in some private-browsing modes), the app still loads and logs, and feeds show "by Someone".

### F15. No access control (intentional)
- **AC-15.1 [QA]** A fresh browser with no stored data can view, log, undo and delete right away. No login, PIN or account screen exists anywhere.

### F16. Look and feel (details in design.md)
- **AC-16.1 [QA]** The header shows the selected pet's name plus its photo when `pets.photo_url` is set for that pet, or a species-appropriate placeholder avatar (design.md §3.0) when it isn't.
- **AC-16.2 [QA]** The app follows the system light or dark setting, and switching the emulated color scheme restyles it without a reload. Every token pair meets the contrast table in `design.md` §2.
- **AC-16.3 [QA]** At 1440×900 it shows the same single column, centered, no wider than 440 px.
- **AC-16.4 [QA]** The tab title is "Pumo Feed Log" and the favicon appears. A 180×180 PNG apple-touch-icon is linked.
- **AC-16.5 [QA]** Every empty, loading and error state in `design.md` §6 appears as specified, with screenshots in `tests/screenshots/`.
- **AC-16.6 [QA]** axe-core finds no serious or critical accessibility violations on home or history, in either color scheme.

### F17. Multiple pets (v1.1)
- **AC-17.1 [QA]** Opening LIVE_URL with no `?pet=` query string shows Pumo's log (`DEFAULT_PET_SLUG`, contract.md §7.1/§7.10) — behavior identical to pre-v1.1 for anyone whose sticker still points at the bare URL.
- **AC-17.2 [QA]** Opening LIVE_URL with `?pet=zuumi` or `?pet=banh-mi` shows that pet's log immediately (no extra tap): its own headline, recent list, counter and guard state, all independent of Pumo's. An unrecognized `?pet=` value (or a pet slug that doesn't exist in the database) falls back to showing Pumo's data, **without rewriting the URL bar** — the address stays exactly what was typed/tapped, only the rendered content falls back. (This keeps the behavior simple and avoids a surprising history-entry rewrite; a bad link just quietly shows Pumo instead of erroring.)
- **AC-17.3 [QA]** A row of pet-picker avatars (design.md §3.0) is visible near the top of the home screen at all times, showing all pets from `getPets()` (contract.md §6.G) in `sort_order`, with the currently-selected pet visually distinguished. Tapping a different pet's avatar navigates to that pet's URL (`pathForPet`, contract.md §7.10) and the whole screen — headline, recent list, counter, guard, log button — updates to that pet within 1 s, with no full page flash beyond a normal navigation.
- **AC-17.4 [QA]** Logging, undoing, deleting, the recent-feed guard, the daily guard and the undo notice all work exactly as in F3–F10, independently per pet. Logging a feed for Zuumi never changes Pumo's headline, counter, recent list or guard state, and vice versa.
- **AC-17.5 [QA]** The history screen (F12) is scoped to whichever pet's URL opened it (`history.html?pet=zuumi` shows only Zuumi's feeds), and its back link returns to that same pet's home screen (`pathForPet`, preserving the query string).
- **AC-17.6 [QA]** Each pet's avatar uses its real photo when `pets.photo_url` is set, or a placeholder distinguished at minimum by the pet's initial and a species-appropriate shape/color (design.md §3.0) when it isn't — placeholders must never be visually identical to each other.
- **AC-17.7 [QA]** `frontend/js/config.js` contains no pet-specific values (no `PUMO_PHOTO_URL` or equivalent) — every pet's name, slug and photo path comes from `getPets()`, confirmed by grep.
- **AC-17.8 [DATHAN]** Each pet's URL (documented in architecture.md §10) is short enough for an NDEF URL record (≤100 characters, per AC-1.1) and has been written to that pet's own NFC sticker and tested on at least one phone.

### F18. Feeding heatmap on the history screen (v1.1)
- **AC-18.1 [QA]** `history.html` shows a calendar-grid heatmap above the day-grouped feed list (design.md §4.1), covering `HEATMAP_WEEKS` (5) weeks including the current partial week, for the currently selected pet only.
- **AC-18.2 [QA]** Columns are Sunday through Saturday left to right, in every locale and screen width the app supports — this is fixed, not locale-dependent like `Intl.DateTimeFormat`'s week start elsewhere. Each cell's date number matches a real calendar date, and each row is one calendar week.
- **AC-18.3 [QA]** A cell's shade reflects the number of feeds *that feed day* (contract.md §7.6 and §7.8), in 5 tiers: 0, 1, 2, 3, 4-or-more (matching `DAILY_FEED_TARGET`). A day with zero feeds for this pet (including before the household had this pet, which the data can't distinguish from an ordinary quiet day) renders normally at the 0 tier, not blank/missing — only genuinely future dates (the grid is anchored on today, contract.md §7.8) are excluded/greyed. **Contrast rule (corrected — a literal 3:1 between every adjacent tier pair is mathematically impossible for a 5-step sequential ramp in sRGB, since that would require ~81:1 of range against a 21:1 ceiling):** the ramp must be monotone in perceptual lightness (e.g. OKLCH `L`), each adjacent step at least 0.06 apart in that space, a single consistent hue across all tiers, and every tier's date-number text must independently meet 4.5:1 against that tier's own fill. Checked per the dataviz skill's method (measured values recorded in the QA report), not picked by eye.
- **AC-18.4 [QA]** Today's cell is visually marked as today (independent of its shade).
- **AC-18.5 [QA]** Tapping/clicking a cell with at least one feed expands inline to show that day's feed times and feeder names (reusing the row style from F2/F12). Tapping a cell with zero feeds, or a padding cell outside the pet's range, does nothing (or shows "No feeds" — frontend agent's call, documented in the build notes). Tapping the expanded cell again, or tapping a different cell, collapses/switches it — only one cell is expanded at a time.
- **AC-18.6 [QA]** The heatmap has a visible legend mapping shade to feed count, and every cell has an accessible name stating the date and feed count (e.g. "Tuesday, September 15: 3 feeds") for screen readers — color is never the only signal, consistent with the AC-8.2 rule elsewhere in this spec.
- **AC-18.7 [QA]** The heatmap reloads with the rest of history.html on focus refresh (AC-6.4) and reflects deletes/undos within 1 s, same as the day-grouped list below it.

### F19. CSV export of full feed history (v1.1)
- **AC-19.1 [QA]** A "Download CSV" control is visible on `history.html` (design.md §4.2). Activating it downloads a `.csv` file (contract.md §7.9) for the currently selected pet's complete feed history — every live feed, not just the loaded page(s) — with header row `date,pet,time,feeder`.
- **AC-19.2 [QA]** The export fetches all pages via `getAllFeedsForExport` (contract.md §6.F.2) regardless of how many "Show older feeds" pages have been loaded on screen so far; with more than `HISTORY_PAGE_SIZE` (100) feeds for a pet, the CSV still contains every one of them.
- **AC-19.3 [QA]** Deleted feeds never appear in the export. A feeder name containing a comma or quote round-trips correctly (RFC 4180 quoting, contract.md §7.9) — verified by exporting a feed logged with a name like `Sam, Jr.` and re-parsing the CSV.
- **AC-19.4 [QA]** While the export is fetching, the control shows a busy state and can't be activated twice at once. If a page fetch fails partway through, no partial file downloads; the control returns to its normal state and (frontend agent's call, documented in build notes) either shows a brief inline error or silently allows retry.
- **AC-19.5 [QA]** The control is reachable by keyboard and has an accessible name that includes the pet's name (e.g. "Download Zuumi's feed history as CSV"), consistent with the icon-only-control labeling rule in design.md §7.
- **AC-19.6 [QA] (v1.2)** The control now sits at the top-right of the heatmap card (design.md §4.2, moved off the full-width slot directly under `<h1>`) and is styled as a subtle text button, not the outlined full-width style it shipped with in v1.1. Its behavior (busy state, keyboard reachability, accessible name) is unchanged by the move.

### F20. Real photos for Zuumi and Banh Mi (v1.2)
- **AC-20.1 [QA]** Zuumi's and Banh Mi's pet-picker avatars (F17, design.md §3.0) show their real photos, not the placeholder shape — `pets.photo_url` is set for all 3 pets now, and AC-17.6's placeholder fallback is exercised only by a hypothetical 4th pet, not by any of today's three.
- **AC-20.2 [QA]** No frontend code change was needed for this — `getPets()` (contract.md §6.G) already returns whatever `photo_url` the database has; F17 already built the "photo vs. placeholder" branch. This item is a one-time data change (`backend/schema.sql`, contract.md §2) plus the two image files (`frontend/assets/zuumi.jpg`, `frontend/assets/banh-mi.jpg`), not new app logic.

### F21. Edit a feed's logged time (v1.2)
- **AC-21.1 [QA]** Every feed row — on the home screen's recent list (F2) and on the history screen's day-grouped list (F12) alike — shows a small Edit icon next to its Delete icon, visible whenever the row is in its normal (non-confirming, non-editing) state.
- **AC-21.2 [QA]** Tapping Edit turns the row into an inline time editor (design.md §3.6b): a native `<input type="time">` pre-filled with that feed's current local time, plus **Save** and **Cancel** buttons. Only one row (across the whole page, and shared with the existing delete-confirmation row per AC-10.5) can be in a non-normal state at once — opening Edit on one row closes any other row's open delete-confirm or edit, and vice versa.
- **AC-21.3 [QA]** Saving a valid time updates the feed's stored `created_at` (contract.md §6.H) to that time **on the feed's original calendar date** — editing changes the time of day only, never the date. The row, the day-grouping, the "n of 4 today" counter and (on history) the heatmap all reflect the change within 1 s, exactly like after a delete (they're already driven live off `created_at` on every render — no special-case code needed, contract.md §7.11).
- **AC-21.4 [QA]** Picking a time later than right now (on today's date) and tapping Save shows an inline error ("Can't set a future time.") without saving, and leaves the editor open so the person can pick a different time. `EDIT_FUTURE_GRACE_MS` (5 min, matching the DB check) absorbs ordinary clock skew rather than being needlessly strict.
- **AC-21.5 [QA]** Tapping Save with the time unchanged from its current value just closes the editor with no network call (contract.md §7.11's `unchanged` case). Tapping Cancel, or pressing Escape, discards the edit and returns the row to normal, same interaction pattern as delete's Cancel/Escape (design.md §3.6).
- **AC-21.6 [QA]** If the save request fails on the network, the row shows an edit-failed state with **Retry** and **Cancel**, mirroring delete's failed state (design.md §3.6b). If the feed was deleted by another phone before the save landed, the row shows "This feed was deleted." and the list refreshes without applying the edit (contract.md §6.H/§8).
- **AC-21.7 [QA]** The Edit and Delete icon buttons are each their own real `<button>` with a distinct accessible name (e.g. "Edit the 7:42 AM feed" / "Delete the 7:42 AM feed"), both keyboard-reachable, both at least 44×44 px tap targets, sitting side by side without shrinking the row below its existing 56 px floor (AC-2.3a) — verify at the 375×553 viewport budget, same as the original delete-only row was verified.
- **AC-21.8 [QA]** Only the time is ever editable through this control. There's no way, through the UI or by inspecting what it sends, to change a feed's pet or feeder — confirmed by contract.md §6.H's "calls that must fail" table (`pet_id`/`logged_by` PATCH attempts still get `42501`).

### F22. Polish pass: CSV placement/order and pet photo/avatar refinements (v1.3)
- **AC-22.1 [QA]** The Download CSV control (F19) is now icon-only — no visible "CSV" text — and sits inline with the heatmap's color-tier legend within the heatmap card's header row (design.md §4.1/§4.2), rather than alone at the top-right as in v1.2. Its accessible name, busy-state behavior (spinner, disabled while fetching) and keyboard reachability are unchanged from AC-19.5/19.6.
- **AC-22.2 [QA]** The exported CSV's data rows are newest-first (contract.md §7.9), matching the order `getAllFeedsForExport` already returns them in — the file reads most-recent-feed-first when opened, instead of the oldest-first order used through v1.2.
- **AC-22.3 [QA]** Zuumi's and Banh Mi's pet-picker avatar photos (F20) are re-cropped so each pet's nose sits roughly at the vertical center of the circle, matching Pumo's existing photo's framing, instead of being pushed toward the top of the frame with the nose near the bottom edge.
- **AC-22.4 [QA]** The pet-picker avatar's visual size increases from 28px/32px (unselected/selected, the AC-2.3a-driven size since v1.1) to 32px/36px (design.md §3.1), re-verified against the AC-2.3a 375×553 fit budget — the Log button and every other AC-2.3a element still fit with no scroll. The 44×44 tap target itself is unchanged (it was already at the accessible minimum and never shrank).

## 5. Out of scope

### 5.1 Nice to have later: don't build these in v1, but don't block them
| Item | What v1 already does to leave room |
|---|---|
| Live realtime push to other open phones | Each page reads data through `api.js` and a single `refresh()`. A realtime subscription can call `refresh()` later, and the table only needs adding to the `supabase_realtime` publication, with no schema change. |
| Installable home-screen PWA icon | The icons already exist (see design.md §8). Adding a manifest and service worker comes later. |
| ~~Logging a feed at a past time~~ | **Built in v1.2 as F21** (editing an already-logged feed's time, not backdating a new log — see F21 and the note on decision #23 below for why that distinction was kept). |
| Restoring a soft-deleted feed in the app | `deleted_at` is nullable and anon may already update it. For now, restoring is done in the Supabase dashboard (architecture.md §9). |
| Printed QR code next to the NFC tag | It would encode that pet's URL (F17), so the app needs no changes. |
| Scheduled keep-alive ping so Supabase doesn't pause the project after 7 days idle | Set up outside the app as a weekly scheduled job hitting the "last 3" GET — no app changes. Dathan asked for this alongside v1.1; see architecture.md §9. |
| Per-pet stats or charts beyond the F18 heatmap (trends, averages, week-over-week comparison) | The `pets`/`feeds` schema (contract.md §1) already supports querying this later; F18 is deliberately the only chart in v1.1. |
| A 4th+ pet, or letting Dathan add/rename/remove pets from the UI | `pets` (contract.md §1) is schema-ready for more rows; adding one is a manual SQL insert (contract.md §2), same as v1's manual Supabase setup. No admin UI is built. |

### 5.2 Cut: don't build these and don't design for them
- Offline mode, or queueing feeds to sync later. No service worker caching of API data.
- Push notifications or reminders.
- Meal type, amount or notes fields.
- Real accounts or login.
- Editing, tagging or reordering pets from the UI (F17 shows a fixed, pre-seeded list). A 4th tag/pet type beyond `cat`/`dog` in `pets.species`.
- Any chart beyond the F18 heatmap; any export format beyond the F19 CSV.

## 6. Decisions made for Dathan

Dathan decided almost everything above. These are the calls the spec-writer made where the brief left room.

**Product behavior**
1. **How the second tap works.** When a guard applies, the button looks quieter (outlined instead of filled) but still reads "Log a feed". The first tap changes it in place to "… — log another?", and a second tap within 6 s logs. If no second tap comes, it reverts. The brief said "changes in place and requires one more tap"; the 6 s revert and the outlined resting style are additions.
2. **Both guards at once** need one combined confirmation, not two extra taps.
3. **The daily guard** applies to the 5th feed of the day and every feed after it. The counter keeps counting past 4 ("5 of 4 today").
4. **"Today"** means local midnight on the phone doing the viewing. All household phones share a time zone, so this only matters for travelers.
5. **Name prompt.** It is an inline card that can be skipped, appears once per phone and never blocks the button. The name can be changed later from a footer link, and names are limited to 20 characters.
6. **Undo notice.** It sits in the page right under the button rather than floating as a toast, so it can't cover the button on small phones. Undo only reverses this phone's most recent log.
7. **Delete confirmation** appears inline in the row rather than as a pop-up, following the brief's no-popup approach.
8. **Freshness without realtime.** The Log button stays disabled until data has loaded. If the data on screen is more than 60 s old when someone taps, the app re-checks the server before deciding whether to log or arm. There is no background polling.

**Technical**
9. **Safety enforced by the database.** Grants limit the `anon` role to inserting only `id` and `logged_by` and updating only `deleted_at`, with no DELETE permission at all. So server timestamps and soft-delete-only hold even if someone calls the API directly. The phone generates each feed's `id`, which makes a retry after a lost response safe.
10. **Supabase platform changes since the brief.** The "anon public" key is now called the **publishable key** (`sb_publishable_…`), and projects created since November 2025 only have that key. It maps to the same `anon` role. Tables created in projects made since May 30, 2026 also need **explicit GRANTs** before the API can reach them, and the SQL includes them.
11. **Stack.** Plain HTML, CSS and JS modules calling Supabase's REST API with `fetch`. No supabase-js, framework or build step. History is a separate `history.html` that loads 100 feeds at a time.
12. **Icons.** v1 ships a favicon and an apple-touch-icon, so a manual "Add to Home Screen" bookmark looks right. There is no manifest or service worker, so the installable PWA stays a later item.
13. **Hosting.** If the setup values table doesn't name a host, the build uses Cloudflare Pages.
14. **`deleted_at` timestamp.** It records the phone's clock. Only whether it is null matters, so its exact value is informational.

**v1.1 additions**
15. **Pet URL scheme.** A query string (`?pet=zuumi`), not a path or subdomain, because GitHub Pages serves static files with no server-side routing, and a query string is the only scheme that works identically whether hosting is GitHub Pages or Cloudflare Pages. Pumo keeps the bare LIVE_URL with no query string (no re-programming Pumo's existing sticker).
16. **Why 3 AM and not, say, 4 AM or "ask each morning."** Dathan said late-night feeding was the trigger, and 3 AM was his stated number — no further product judgment was needed here.
17. **Heatmap buckets by feed count, not hours.** The reference image Dathan supplied was an hours-based activity tracker; feed count is the metric this app actually has, so the legend/tiers use `DAILY_FEED_TARGET` (4) as the top bucket, matching the counter's own meaning of "a full day."
18. **CSV export scope: the selected pet only, not all pets at once.** A single combined export would need a pet column anyway (which it has) and could be reconstructed by exporting each pet, but scoping to one pet keeps the button's meaning ("this pet's history") consistent with every other control on the history screen, all of which are pet-scoped.
19. **Keep-alive ping lives outside the app**, as a separately scheduled job (not a feature described in this spec, since it has no user-facing behavior) — see architecture.md §9.

**v1.2 additions**
20. **"More subtle" for the CSV button (F19/design.md §4.2) means text-style, not outlined-full-width.** Dathan's ask was specifically to move it to the heatmap's top-right corner and tone it down; `.btn--text` already existed as a design-system variant (used nowhere yet), so this reuses an existing pattern rather than inventing a new one.
21. **Editing a feed's time changes only the time, never the date.** Dathan's request was "make the times editable" for fixing a mistaken or forgotten-to-log time — a same-day correction. Moving a feed to a different calendar date is a different, rarer need (out of scope here; delete-and-relog still covers it) and would have required a full date+time picker instead of the simpler native `<input type="time">`.
22. **A future-time edit is blocked, with a DB-level backstop, not just a client-side check.** Consistent with decision #9's philosophy that the database is the actual guarantee, not the UI: `feeds_created_at_not_future` (contract.md §1/§3) rejects it even via a direct API call, with a 5-minute grace window for ordinary clock skew.
23. **This is "edit an already-logged feed's time," not "log a feed and pick its time up front."** The nice-to-have list (§5.1) described "logging a feed at a past time" as a single combined action; splitting it into "log now, correct after" instead keeps the primary Log button exactly as simple as F3 already made it (one tap, no picker in the way) and reuses the existing delete-confirmation row pattern for the edit UI rather than adding a picker to the main logging flow.

## 7. What success looks like

A week after launch, all four people and any cat-sitter use the sticker without being reminded. When Pumo yowls at the bowl, anyone can answer "has he eaten?" in under 5 seconds, from any phone, and get the same answer. Double feeds stop, because the 2-hour and 4-a-day guards catch the reflex tap without annoying anyone on a normal feed. Nobody has lost a feed record, since a wrong tap is one Undo away and nothing is ever hard-deleted. Dathan's total hands-on setup is under an hour plus sticker shipping, and after that the app needs no maintenance. **As of v1.1:** the same is true for Zuumi and Banh Mi, each answerable from their own sticker; a glance at the history heatmap shows feeding patterns across the last month without anyone counting rows; and a CSV download gives Dathan a portable backup whenever he wants one, on top of Postgres already keeping every feed forever. **As of v1.2:** Zuumi and Banh Mi's pickers show their actual faces instead of placeholders, the CSV button no longer competes visually with the heatmap for attention, and a mistaken feed time is a two-tap fix instead of a delete-and-relog. **As of v1.3:** the CSV control is a compact icon inline with the legend rather than its own labeled button, the exported file opens with the most recent feed first, and Zuumi and Banh Mi's picker photos are framed on their noses at a slightly larger, easier-to-recognize size.
