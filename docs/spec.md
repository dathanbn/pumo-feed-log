# Pumo Feed Log: v1 spec

Status: approved by Dathan. The build runs unattended from `docs/` and nobody will be asked anything during it. If these files seem to disagree: `contract.md` wins on data, constants and formatting rules, `design.md` wins on visuals and copy, and this file wins on behavior.

## 1. Goal

Pumo begs for food whether or not he has eaten, so the four people in the household can't tell if he has already been fed. Pumo Feed Log fixes that with one NFC sticker on his food container. Tap it with any phone and a small web page opens. The page shows when Pumo was last fed, how many times he has eaten today, and a big button that logs a feed in one tap. All four phones read and write one shared Supabase database, so everyone sees the same answer and nobody feeds him "just in case."

## 2. Target user

- **Primary:** the 4 people in Dathan's household, each with their own phone (assume a mix of iPhone and Android). Typical use: standing at the food container, scoop in hand, a 5-second tap and glance. Most visits are "has he eaten?", and some are "I'm feeding him now."
- **Occasional:** a cat-sitter or guest who has never seen the app. They need zero setup: no account, no install, no PIN.
- **Not for:** multiple pets, vets, or anyone who wants accounts, stats or reminders.

## 3. Terms

- **Feed:** a row in `feeds` whose `deleted_at` is null.
- **Deleted feed:** a row whose `deleted_at` is not null. The app never shows it or counts it.
- **Today:** from 00:00 local time on the phone doing the viewing up to now.
- **Recent guard:** the most recent feed was less than `RECENT_FEED_GUARD_MS` (2 hours) ago.
- **Daily guard:** today's feed count is already at or above `DAILY_FEED_TARGET` (4).
- **Guarded:** at least one guard applies.
- **Armed:** the Log button after one tap while guarded. It is waiting for a confirming second tap.
- **LIVE_URL:** the deployed app URL from the setup values table in `architecture.md`.
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
- **AC-5.2 [QA]** The database itself rejects a direct REST POST or PATCH that tries to set `created_at` (401 or 403, code `42501`). This is not just app behavior.

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
- **AC-8.1 [QA]** The counter reads "{n} of 4 today". n is the number of feeds whose `created_at` is at or after 00:00 today, local time on the viewing phone. With no feeds today it reads "0 of 4 today".
- **AC-8.2 [QA]** When n is 4 or more, the counter uses the warning style: warning color, a warning icon and screen-reader text ", daily limit reached". It keeps counting past 4, so a fifth feed shows "5 of 4 today". When n is 3 or less, it uses the normal style.
- **AC-8.3 [QA]** With n = 4 and the last feed more than 2 hours old, the first tap arms the button as "4 of 4 today — log another?". The second tap logs, and the counter then reads "5 of 4 today".
- **AC-8.4 [QA]** When both guards apply, there is one combined armed label, for example "Fed 40m ago, 4 of 4 today — log another?". Logging takes exactly 2 taps in total.
- **AC-8.5 [QA]** The count resets at local midnight. With the clock at 00:00:30 the next day, the counter reads "0 of 4 today" and no daily guard applies. The recent guard can still apply, for example to an 11:30 PM feed. A page left open across midnight resets within 30 s. **[UNIT]** Local midnight is correct in `America/Los_Angeles`, including the DST days 2026-03-08 and 2026-11-01.

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
- **AC-16.1 [QA]** The header shows "Pumo" plus his photo when `PUMO_PHOTO_URL` is set, or the cat-head avatar when it isn't.
- **AC-16.2 [QA]** The app follows the system light or dark setting, and switching the emulated color scheme restyles it without a reload. Every token pair meets the contrast table in `design.md` §2.
- **AC-16.3 [QA]** At 1440×900 it shows the same single column, centered, no wider than 440 px.
- **AC-16.4 [QA]** The tab title is "Pumo Feed Log" and the favicon appears. A 180×180 PNG apple-touch-icon is linked.
- **AC-16.5 [QA]** Every empty, loading and error state in `design.md` §6 appears as specified, with screenshots in `tests/screenshots/`.
- **AC-16.6 [QA]** axe-core finds no serious or critical accessibility violations on home or history, in either color scheme.

## 5. Out of scope

### 5.1 Nice to have later: don't build these in v1, but don't block them
| Item | What v1 already does to leave room |
|---|---|
| Live realtime push to other open phones | Each page reads data through `api.js` and a single `refresh()`. A realtime subscription can call `refresh()` later, and the table only needs adding to the `supabase_realtime` publication, with no schema change. |
| Installable home-screen PWA icon | The icons already exist (see design.md §8). Adding a manifest and service worker comes later. |
| Logging a feed at a past time | `created_at` is already a normal column. A later version adds one grant (or an RPC) plus the UI. |
| Restoring a soft-deleted feed in the app | `deleted_at` is nullable and anon may already update it. For now, restoring is done in the Supabase dashboard (architecture.md §9). |
| Printed QR code next to the NFC tag | It would encode the same LIVE_URL, so the app needs no changes. |
| Scheduled keep-alive ping so Supabase doesn't pause the project after 7 days idle | This would be an external cron job calling the "last 3" GET, with no app changes. |

### 5.2 Cut: don't build these and don't design for them
- A calendar view of history.
- Offline mode, or queueing feeds to sync later. No service worker caching of API data.
- Push notifications or reminders.
- Meal type, amount or notes fields.
- Real accounts or login.
- Multiple pets, multiple tags, stats or charts. No `pet_id` or `tag_id` columns and no tables beyond `feeds`.

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

## 7. What success looks like

A week after launch, all four people and any cat-sitter use the sticker without being reminded. When Pumo yowls at the bowl, anyone can answer "has he eaten?" in under 5 seconds, from any phone, and get the same answer. Double feeds stop, because the 2-hour and 4-a-day guards catch the reflex tap without annoying anyone on a normal feed. Nobody has lost a feed record, since a wrong tap is one Undo away and nothing is ever hard-deleted. Dathan's total hands-on setup is under an hour plus sticker shipping, and after that the app needs no maintenance.
