# Pumo Feed Log: design brief

## 1. Look and feel

- **Phone first, glance first.** Someone standing at the food bin with a scoop in one hand should get the answer in 2 seconds: when Pumo was last fed and how many times today. Everything else is secondary.
- **Pumo's personality, used sparingly.** His name is big at the top, next to his photo (or a simple cat-head avatar). The background is a warm cream and there is one line of dry humor in the header: "Don't trust the meows." Everything else is plain and obvious. No mascot animations, no cutesy error messages.
- **Light and dark mode** follow the system automatically (`prefers-color-scheme`), with no in-app toggle. Set `color-scheme: light dark` and add a `theme-color` meta tag for each scheme.
- **Desktop** gets the same single column, centered, no wider than 440 px. There is no separate desktop layout.
- **Colors carry meaning.** Blue (`--accent-strong`) means ready, normal or "the active/selected thing" (including the selected pet's avatar ring, v1.1). A warm brown/rust (`--danger`/`--warning`) is used only for warnings and armed/not-saved states.

## 2. Visual system

**This section documents the "Pumo" Design System palette** (a warm cream/ink/blue system with Fredock type), which replaced the original teal palette described in an earlier draft of this file during a frontend redesign that predates v1.1. The table below is the *shipped* token set — treat it as current, not the historical one.

### Color tokens (define on `:root` and swap under `@media (prefers-color-scheme: dark)`)
| Token | Light | Dark | Used for |
|---|---|---|---|
| `--surface-100` | `#FBF2E4` | `#1E1913` | Page background |
| `--surface-000` | `#FFFDF8` | `#2A231B` | Rows, cards |
| `--surface-200` | `#EDE1CE` | `#332B21` | Recessed/track surfaces (e.g. progress-bar track) |
| `--border-strong` | `#8F7E69` | `#7E6B54` | Input borders, outlined-button border, meaningful outlines |
| `--ink` | `#262019` | `#F3E9D8` | Main text |
| `--ink-soft` | `#6E6255` | `#C2B29C` | "by Sam", tagline, secondary text |
| `--accent` | `#BFE1F0` | `#24404C` | Soft fill (e.g. normal counter pill, selected-pet ring background) |
| `--accent-strong` | `#1B6E93` | `#6FBBDE` | Primary button fill, links, focus ring, selected-pet avatar ring |
| `--on-accent-strong` | `#FFFFFF` | `#16222A` | Text/icons on `--accent-strong` |
| `--warning` | `#8A4B12` | `#E7A756` | Warning text and icons |
| `--warning-bg` | `#F6E1C2` | `#4A341C` | Warning counter pill background |
| `--danger` | `#A23B2B` | `#E2836F` | Armed/not-saved button fill, delete button, warning-severity states |
| `--danger-bg` | `#F5DAD3` | `#4A241C` | Delete-confirm panel background |
| `--on-danger` | `#FFFFFF` | `#1E1913` | Text on `--danger` |
| `--success` | `#2F7A4F` | `#7FC98F` | Reserved (not currently used on a filled background) |

There is no separate avatar-ring token (a `--pumo` token existed in an earlier draft, now removed) — the selected pet's avatar ring uses `--accent-strong`, consistent with every other "this is the active/primary thing" use of that token.

### Measured contrast (WCAG 2.1, against the table above)
| Pair | Light | Dark |
|---|---|---|
| ink on surface-100 | 14.65 | 15.92 |
| ink on surface-000 | 15.66 | 14.08 |
| ink-soft on surface-100 | 5.87 | 7.68 |
| ink-soft on surface-000 | 6.27 | 6.80 |
| on-accent-strong on accent-strong | 5.34 | 9.02 |
| accent-strong on surface-000 | 5.34 | 7.94 |
| warning on warning-bg | 6.58 | 8.10 |
| on-danger on danger | 6.57 (see contract.md §2's `--on-danger` note — measured, not assumed) | 6.41 |
| danger on surface-000 | 5.02 | 5.11 |
| border-strong vs surface-000 (UI boundary, needs 3:1 or more) | 3.86 | 3.42 |

If a color changes during a future build, re-measure it — these are the last-measured values, not guarantees. Text needs at least 4.5:1, and UI boundaries and large text need at least 3:1. (The heatmap's own sequential ramp, §4.1, follows a different rule — see spec.md AC-18.3.)

### Type
- Font: **Fredoka** (Google Fonts — loaded via `<link>` in both HTML files, an intentional exception adopted in the same redesign that replaced §2's palette above; an earlier draft of this file said the stack "downloads no web fonts," which is no longer accurate), falling back to `ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` if the network request fails or is slow.
- Sizes are in `rem`, with the root at 100%, so system text-size settings scale the whole app. Body text 1.0625rem (17 px). Headline value 2.5rem (40 px) bold. Header name 1.375rem (22 px) bold. Counter and secondary text 0.9375rem (15 px), with the counter semibold.
- Times use `font-variant-numeric: tabular-nums`.

### Spacing and shape
- 4 px grid. Page gutter 16 px plus `env(safe-area-inset-*)`. Column max width 440 px.
- Row and card corner radius 16 px, button radius 20 px.
- Primary button: full width, at least 64 px tall.

### Motion (turned off entirely under `prefers-reduced-motion: reduce`)
- Button press: scale to 0.98 for 80 ms.
- Armed state: a 3 px bar along the button's bottom edge shrinks over 6 s.
- Undo notice: a 3 px bar shrinks over 10 s, and the notice fades in over 150 ms.
- On a confirmed log, call `navigator.vibrate(30)` where the browser supports it (Android). iOS ignores it silently.

## 3. Home screen (`index.html`)

### 3.0 Pet picker (v1.1, new — sits above 3.1's header)
- A single row of circular avatars, one per pet from `getPets()` (contract.md §6.G), in `sort_order`, above the existing header. 40 px circles, 8 px gaps, horizontally centered (3 pets never need to scroll at 375 px width).
- The **selected** pet's avatar is larger (48 px, matching the old single-avatar size) with a 2 px `--accent-strong` ring (§2); the other pets' avatars are 40 px, no ring, `opacity: 0.7` until focused/hovered.
- Each avatar shows the pet's photo (`pets.photo_url`) when set, or a placeholder: a filled circle in a per-species tint (reuse `--accent` family for cats, a new neutral `--border`-family tint for dogs — don't invent a new hue) with the pet's first initial in the header font, bold, centered. Cats and dogs must be visually distinguishable even before reading the initial (e.g. a subtly different icon glyph or shape accent), since "same colored circle, different letter" is easy to misread at a glance.
- Tapping a non-selected avatar navigates to `pathForPet(slug)` (contract.md §7.10) — a normal in-app navigation (change `location.href`), not a client-side state swap, so the URL bar always reflects the pet on screen and the page can be bookmarked/re-shared per pet.
- Each avatar is a real `<a href="...">`, `aria-current="true"` on the selected one, and `aria-label="{pet name}"` when there's no visible text label under it (keep it to avatars only, no name captions, to protect the AC-2.3 vertical budget).
- This replaces the old fixed 44px "avatar in the header" concept from v1 visually — the header's avatar (3.1 below) becomes the *selected* pet's large avatar, i.e. 3.0 and the header's avatar are the same element for the selected pet, not two separate avatars stacked.

### 3.1 Layout, top to bottom
```
┌─────────────────────────────────────┐
│ [refresh-error banner, only if any] │
│ (◉) Pumo         (z)  (b)           │  picker + header combined (§3.0): selected pet's
│     Don't trust the meows.          │  large ringed avatar + h1 IS the header avatar;
│                                     │  the other pets' small avatars sit beside it
│ Last fed                            │  headline: 17px label
│ 1h 40m ago                          │  + 40px bold value (one <p>)
│ [ 3 of 4 today ]                    │  counter pill (warning style at >=4)
│                                     │
│ RECENT                              │  small caps label, muted
│ ┌─────────────────────────────────┐ │
│ │ Today, 7:42 AM             [🗑] │ │  row: 56px min height
│ │ by Sam                          │ │  line 1 --text 17px semibold
│ ├─────────────────────────────────┤ │  line 2 --muted 15px
│ │ Today, 3:10 AM             [🗑] │ │  delete: 44x44 icon button, right
│ │ by Alex                         │ │
│ ├─────────────────────────────────┤ │
│ │ Yesterday, 9:55 PM         [🗑] │ │
│ │ by Someone                      │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [         Log a feed              ] │  primary button, 64px+
│ [undo notice, only after a log    ] │  inline, pushes content down
│ Full history  ›                     │  44px tall link
│                                     │
│ [name card, first visit only]       │  may sit below the fold
│ Logging as Sam · Change             │  footer, muted
└─────────────────────────────────────┘
```
The target heights are chosen so everything down to the Log button fits in 375×553, and the history link also fits in 390×664 (AC-2.3). If it doesn't fit, shrink vertical gaps first, then the avatar (down to 40 px). Never shrink the button below 64 px or the rows below 56 px. **v1.1 adds the picker row (§3.0) above the header, which eats into the same 553 px budget.** If gap-shrinking and the 40 px avatar floor aren't enough to keep the fit, the next thing to shrink is the picker row's own height (down to a 32 px selected avatar / 28 px others, still with an 8 px gap and 44×44 tap target via padding) — never the recent-list rows or the button. Re-verify AC-2.3 against the real rendered picker; it's a new element in an already tight budget.

### 3.2 Headline
- One `<p>` holding `<span class="label">Last fed</span> <span class="value">1h 40m ago</span>`, so screen readers hear "Last fed 1h 40m ago".
- The value refreshes every `TICK_MS` (30 s). It is **not** an aria-live region, because announcing it every 30 s would be noise.
- With no feeds, the value slot holds "No feeds logged yet" at 1.5rem and the label is hidden.

### 3.3 Counter pill
- Normal: `--surface` fill, 1 px `--border` outline, `--text`, reading "3 of 4 today".
- Warning (n ≥ 4): `--warn-soft` fill, `--warn-text` text, a leading warning-triangle SVG icon with `aria-hidden`, and visually hidden text ", daily limit reached". Color is never the only signal.

### 3.4 Log button states
| State | Label | Style | Interactive |
|---|---|---|---|
| `loading` | Loading… | `--surface` fill, `--muted` text | disabled |
| `ready` | Log a feed | `--accent` fill, `--on-accent` text | yes, logs |
| `guarded` | Log a feed | `--surface` fill, 2 px `--accent` border, `--accent` text | yes, arms |
| `checking` | Checking… | same as the style it came from, with spinner | disabled |
| `armed` | e.g. "Fed 1h 40m ago — log another?" (rules in contract.md §7.2) | `--warn-fill` fill, `--on-warn` text, 6 s shrinking bar | yes, logs |
| `saving` | Saving… | `--accent` fill, spinner | disabled |
| `logged` | ✓ Logged | `--accent` fill, check SVG | disabled for `LOGGED_FLASH_MS` (2 s), then `guarded` |
| `not-saved` | Not saved, tap to retry | `--warn-soft` fill, 2 px `--warn-text` border, `--warn-text` text | yes, retries |
| `load-failed` | Try again | `--accent` fill | yes, reloads data |

Labels can wrap to two lines, and the button grows to fit. Text is never truncated.

### 3.5 Undo notice (inline, directly below the button)
- `--surface` card holding "Logged 7:42 AM" on the left and an **Undo** text button (44 px tall, `--accent`) on the right, plus a 10 s shrinking bar along the bottom.
- The card has `role="status"`. It then shows "Undoing…", then "Feed removed" for 3 s before disappearing.
- On failure: "Couldn't undo" in `--warn-text`, with **Retry** and a ✕ **Dismiss** button (`aria-label="Dismiss"`). No timer runs in this state.

### 3.6 Delete confirmation (inline, replaces the row)
- The row grows to show the sentence from contract.md §7.5, for example "Delete the 7:42 AM feed? Last feed will then show 3:10 AM. Today's count goes from 2 to 1."
- Two buttons below the sentence: **Cancel** (outlined) and **Delete** (`--warn-fill` fill), each at least 44 px tall with 12 px between them.
- When it opens, focus moves to Cancel, and Escape cancels. "Deleting…" replaces the buttons while the request is in flight.
- On failure: "Couldn't delete." in `--warn-text`, with **Retry** and **Cancel**.

### 3.7 Name card (first visit on a phone only)
- `--surface` card below the history link.
- Title "Who's feeding Pumo?", then the body "Pick a name for this phone so everyone sees who logged each feed. No account needed."
- A visible `<label>` "Your name" above a text input (placeholder "e.g. Sam", `maxlength="20"`, `autocomplete="given-name"`, `enterkeyhint="done"`).
- Buttons: **Save** (accent, disabled while the input is empty) and **Skip** (text button).
- The footer's Change or Set name link reopens this card with the current name filled in.

## 4. History screen (`history.html`)
```
┌─────────────────────────────────────┐
│ ‹ Pumo                              │  back link to index.html, 44px, pet-scoped (§3.0/§4.0)
│ Feed history                        │  h1
│ [        Download CSV             ] │  §4.2, outlined button below h1
│                                     │
│ [ heatmap: 5 weeks, Sun...Sat ]     │  §4.1, above the feed list
│                                     │
│ Today                       2 feeds │  h2 + muted count, right aligned
│ ┌─────────────────────────────────┐ │
│ │ 7:42 AM                    [🗑] │ │  same row component as home,
│ │ by Sam                          │ │  but time only (day is in heading)
│ ├─────────────────────────────────┤ │
│ │ 3:10 AM                    [🗑] │ │
│ │ by Alex                         │ │
│ └─────────────────────────────────┘ │
│ Yesterday                   4 feeds │
│ ...                                 │
│ Monday, September 14        3 feeds │
│ ...                                 │
│ [       Show older feeds          ] │  outlined button, only if more exist
└─────────────────────────────────────┘
```
- It is a plain list: `<section>` per day, `<h2>` heading, `<ul>` of rows. Headings don't stick. Day groups and headings use the **feed day** (contract.md §7.6), so a 1:30 AM feed sits under the previous day's heading — same rule as the home screen's counter.
- Delete confirmation works exactly as on home (§3.6), and the consequence text uses the loaded history data.
- There is no Log button on this screen.
- The back link and the whole page are scoped to whichever pet's URL opened it, per §3.0/contract.md §7.10.

### 4.1 Feeding heatmap (v1.1, new — above the day-grouped list)
- A `--surface` card, full column width, containing a small legend (4 swatches + "0" / "1" / "2" / "3" / "4+", left to right, muted 13px text under or beside the swatches) and a 7-column grid below it: `Sun Mon Tue Wed Thu Fri Sat` as a muted 12px header row, then `HEATMAP_WEEKS` (5) rows of date cells, oldest week first (top), current (possibly partial) week last (bottom) — so it reads top-to-bottom like a wall calendar, newest at the bottom nearest the list it introduces.
- Each cell: a rounded-rect (8px radius) roughly square (min 40×40 including gap, so 5 weeks × 7 columns fits 375px width with the page's 16px gutters — do the arithmetic against the real gutter/gap values chosen, this is a floor not an exact spec), the date number in its top-left corner in 11px `--muted`-on-empty / an on-fill-appropriate color on filled tiers, and a fill color from a 5-step sequential ramp (0 = `--surface` or `--divider`, 1 through 4 = increasing-intensity steps of the `--accent` family — check the dataviz skill for the exact ramp method, it must hold WCAG contrast between adjacent steps and for the date-number text sitting on top of each step, in both light and dark).
- A cell for a future date — the only kind of out-of-range cell that exists, since the grid is anchored on today and always starts on a Sunday (contract.md §7.8) — renders at the 0/empty tier but slightly reduced opacity (0.4) and is not tappable. This only ever affects days later in the *current* (bottom) row, never the first row. A day with genuinely zero feeds (including before the household had this pet) is not out-of-range — it's a normal, tappable, empty-tier cell; there's no way to distinguish "0 feeds" from "pet didn't exist yet" in the data, so don't try to.
- Today's cell gets a 2px `--accent` (or `--accent-strong`, whichever is defined) outline in addition to its fill, regardless of tier, so "today" is always findable at a glance.
- Tapping/clicking an in-range cell with `count > 0` expands an inline panel directly below the grid (push content down, no overlay/modal — consistent with this app's no-popup philosophy) listing that day's feeds using the same row look as the list below (time + "by {name}"), with a small close affordance. Tapping a `count === 0` in-range cell either does nothing or shows a one-line "No feeds that day" (frontend agent's call). Only one cell is expanded at once; opening another closes the first.
- Every cell is a real `<button>` (even the non-interactive padding ones, `disabled`), with `aria-label` stating the full date and count, e.g. `aria-label="Tuesday, September 15: 3 feeds"` — never relying on the visual date number plus color alone.
- Under `prefers-reduced-motion: reduce`, the expand/collapse is instant (no slide/height transition), consistent with §1's motion rules elsewhere.

### 4.2 Download CSV button (v1.1, new)
- An outlined button (`.btn.btn--outline`, matching the existing "Show older feeds" visual weight, not the primary accent button — this is a secondary, occasional action), placed directly under the `<h1>` and above the heatmap, full width like other secondary buttons on this screen.
- Label: "Download CSV". While fetching all pages for the export, it shows a spinner and "Preparing…", disabled, matching the `checking`/`loading` button-state visual language already established for the Log button (design.md §3.4) rather than inventing a new style.
- `aria-label="Download {pet name}'s feed history as CSV"` (AC-19.5) — the visible label stays short ("Download CSV"); the fuller pet-specific name is accessible-only, since the page's own `<h1>`/pet context already makes it visually obvious which pet.

## 5. Copy (exact strings)
| Where | Text |
|---|---|
| Home tab title | Pumo Feed Log |
| History tab title | Feed history · Pumo Feed Log |
| Header | Pumo / Don't trust the meows. |
| Headline | Last fed {relative} / No feeds logged yet |
| Counter | {n} of 4 today (+ hidden ", daily limit reached" when n ≥ 4) |
| Recent label | Recent |
| Recent list, no feeds | When Pumo gets fed, tap the button below. |
| Row by-line | by {name} / by Someone |
| Row delete, accessible label | Delete feed from {day and time}, by {name or Someone} |
| Delete confirm | Delete the {label} feed? {consequence} · Cancel · Delete |
| Delete in flight / failed | Deleting… / Couldn't delete. · Retry · Cancel |
| Undo notice | Logged {time} · Undo → Undoing… → Feed removed |
| Undo failed | Couldn't undo · Retry · Dismiss |
| History link | Full history |
| Name card | Who's feeding Pumo? / Pick a name for this phone so everyone sees who logged each feed. No account needed. / Your name / Save / Skip |
| Footer | Logging as {name} · Change / No name on this phone · Set name |
| Load error title | Can't load feeds |
| Offline body | You're offline. Connect to Wi-Fi or data, then try again. |
| Unreachable body | Can't reach the feed log right now. |
| Paused hint (after 2 failures in a row while online) | Still can't connect. If nobody has opened the app for a week, the database may be paused. It can be unpaused from the Supabase dashboard, and no feeds are lost. |
| Refresh banner | Couldn't refresh. Showing feeds as of {time}. · Retry |
| History | ‹ Pumo / Feed history / {n} feed(s) / Show older feeds |
| History empty | No feeds logged yet. |
| History load error | Can't load history. · Try again |
| Older page error | Couldn't load older feeds. · Retry |
| CSV button | Download CSV |
| CSV button, in flight | Preparing… |
| CSV export failed | Couldn't prepare the download. · Retry |
| Heatmap legend | 0 · 1 · 2 · 3 · 4+ |
| Heatmap empty cell (accessible name pattern) | {Weekday}, {Month} {day}: {n} feed(s) / no feeds |
| Pet picker (accessible name pattern, per avatar) | {Pet name} |

## 6. Empty, loading and error states

| # | Situation | What the user sees |
|---|---|---|
| S1 | **First load ever, zero feeds** | Headline "No feeds logged yet". Counter "0 of 4 today" (normal style). The Recent list is replaced by "When Pumo gets fed, tap the button below." Button `ready`. Name card shown if this phone has no name. |
| S2 | **Home loading (first fetch on this page)** | Header renders right away. The headline value and 3 rows show as `--divider` placeholder bars (static, no shimmer). The counter pill reads "– of 4 today". Button `loading`. Lists have `aria-busy="true"`. After `REQUEST_TIMEOUT_MS` this becomes S3. |
| S3 | **Home load fails with no data yet** | The headline and recent list are replaced by a `--warn-soft` panel: "Can't load feeds" plus the offline or unreachable body text, and the paused hint from the second failure in a row. Counter hidden. Button `load-failed` ("Try again"). |
| S4 | **Refresh (focus or retry) fails while data is on screen** | The data stays. A banner at the top reads "Couldn't refresh. Showing feeds as of 7:42 AM." with Retry. The next Log tap still follows the 60 s freshness rule, so a stale screen can't log blindly. |
| S5 | **Network error while logging** | Button `not-saved` ("Not saved, tap to retry"). Nothing is added to the list, no undo notice appears, and the status region announces "Not saved. Tap to retry." |
| S6 | **Pre-log freshness check fails** | Same as S5. Retrying re-runs the check and the guards. |
| S7 | **Network error while undoing** | Undo notice in its failed state (§3.5). The feed stays visible. |
| S8 | **Network error while deleting** | Row in its failed state (§3.6). |
| S9 | **History loading** | h1 visible, then 2 placeholder day groups of 3 rows each, with `aria-busy`. |
| S10 | **History, zero feeds** | "No feeds logged yet." under the h1, and nothing else. |
| S11 | **Network error while loading history** | A `--warn-soft` panel reading "Can't load history." with a Try again button, plus the paused hint on the second failure in a row. |
| S12 | **"Show older feeds" fails** | The loaded groups stay, and under them: "Couldn't load older feeds." with Retry. |
| S13 | **Supabase project paused or unreachable** | It looks like S3, S5 or S11. The paused hint appears once 2 requests in a row have failed while `navigator.onLine` isn't false. |
| S14 | **localStorage unavailable** | No visible error. The name card's Skip or Save simply doesn't persist, and feeds log as "by Someone". |
| S15 | **CSV export fails partway through paging** (v1.1) | The Download CSV button returns to its normal state; no partial file downloads. Shows "Couldn't prepare the download." with Retry, in the same warn style as other inline errors (frontend agent's call whether this is a transient banner or a persistent line under the button — document the choice). |
| S16 | **Heatmap cell expanded, then its day's last feed is deleted** (v1.1) | The expanded panel updates to reflect zero feeds for that day within 1 s, consistent with F10's "other screens drop it on their next load or focus" rule, and the cell's own shade/tier recomputes. |

## 7. Accessibility baseline

- **Tap targets.** The primary button is full width and at least 64 px tall. Every other control (row Delete, Undo, Retry, Cancel, Dismiss, links, Save, Skip) is at least 44×44 CSS px, using padding where needed, with at least 8 px between neighbors.
- **Contrast.** It follows the §2 table: text at least 4.5:1, large text and UI boundaries at least 3:1, verified in both schemes. Warning states always pair color with text (the armed label, "daily limit reached", "Not saved") and, where noted, an icon.
- **Screen-reader labels for icon-only elements.**
  - Row Delete: `aria-label="Delete feed from Today, 7:42 AM, by Sam"`.
  - Dismiss ✕: `aria-label="Dismiss"`.
  - The warning icon, check icon and spinner are `aria-hidden="true"`.
  - Avatar: Pumo's photo gets `alt="Pumo"`. The fallback SVG avatar is `aria-hidden` because the h1 already says "Pumo".
- **Live announcements.** One visually hidden `role="status" aria-live="polite"` region per page announces:
  - "Saving"
  - "Logged at 7:42 AM. Undo available for 10 seconds."
  - "Not saved. Tap to retry."
  - The armed prompt, as "Pumo was fed 1h 40m ago. Tap again to log another feed." (or the daily or combined variant)
  - "Feed removed"
  - "Feed deleted"
  - Load and refresh errors.
- **Semantics.** `lang="en"`. One `<h1>` per page and `<h2>` for day headings. Lists use `<ul>`/`<li>`, times use `<time datetime="…">`, and every control is a real `<button>` or `<a>`.
- **Keyboard.** Everything works with Tab, Enter and Space, and the focus ring is always visible (3 px `--accent` outline, 2 px offset). Escape closes a delete confirmation. After a delete, focus moves to the next row, or to the section heading if there is no next row.
- **Zoom and text size.** Never set `maximum-scale` or `user-scalable=no`. At 200% text size the layout wraps without clipping or horizontal scrolling.
- **Reduced motion.** Every transition and shrinking bar is off, while state changes still happen instantly.

## 8. Visual assets

| Asset | Needed? | Source | Spec |
|---|---|---|---|
| Pumo photo | Optional | Dathan puts a photo at `docs/assets/pumo.jpg` before the build (already supplied for v1) | The build center-crops it to a square, resizes to 256×256, strips EXIF (phone photos can carry GPS location), keeps it under 100 KB and saves it as `frontend/assets/pumo.jpg`, referenced by `pets.photo_url` (contract.md §1). Shown as a 48 px circle with a 2 px `--accent-strong` ring when selected, 40 px unringed in the picker row otherwise. |
| Zuumi / Banh Mi photos (v1.1) | Optional, **not yet supplied** | Dathan said he'll add these later at `docs/assets/zuumi.jpg` / `docs/assets/banh-mi.jpg` | Same processing as Pumo's photo when present. Until supplied, `pets.photo_url` stays `null` for these two and they use the placeholder avatar below — this is the expected v1.1 launch state, not a defect. |
| Placeholder avatar (v1.1, per pet without a photo) | Required for Zuumi and Banh Mi at launch | Build agent draws it (CSS/inline SVG, no image asset needed) | A filled circle, `--accent`-family tint for a cat (`species: 'cat'`), a `--border`-family neutral tint for a dog (`species: 'dog'`), with the pet's first initial centered in the header font. Cats and dogs need a shape/glyph distinction beyond color alone (§3.0) — a simple pair of pointed ear-shapes behind a cat's circle vs. none for a dog is enough; keep it as understated as the existing cat-head icon.svg. |
| Avatar fallback (pre-v1.1, `Pumo`-specific) | Required | Build agent | `frontend/assets/icon.svg`, the same drawing as the app icon. As of v1.1 this is Pumo's specific fallback (species `cat`, matching the placeholder-avatar rule above) rather than a generic app fallback — the app icon itself (favicons, apple-touch-icon) is unaffected and stays pet-neutral. |
| App icon | Required | Build agent draws it. Dathan may optionally supply a Canva design at `docs/assets/icon.png` (512×512 PNG), which then takes priority. | `frontend/assets/icon.svg` in a 512×512 viewBox: a `--accent` (`#0B6B66`) rounded square (rx 112) with a simple cream (`#FBF7F2`) cat head (a wide ellipse with two triangle ears) and two small teal eye dots. No text and no emoji, so it renders identically everywhere. |
| Favicons | Required | Generated from the icon | `<link rel="icon" type="image/svg+xml" href="assets/icon.svg">`, plus `assets/favicon-32.png` (32×32) as a PNG fallback. |
| Apple touch icon | Required | Generated from the icon | `assets/apple-touch-icon.png`, 180×180, opaque background, linked with `<link rel="apple-touch-icon">`. |
| Icons inside the UI | Required | Inline SVG in the HTML or JS | Trash, warning triangle, check, chevron, spinner. No icon font. |

Missing assets never block the build. With no photo, use the SVG avatar. With no Canva icon, use the drawn SVG.
