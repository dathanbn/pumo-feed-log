# Pumo Feed Log: design brief

## 1. Look and feel

- **Phone first, glance first.** Someone standing at the food bin with a scoop in one hand should get the answer in 2 seconds: when Pumo was last fed and how many times today. Everything else is secondary.
- **Pumo's personality, used sparingly.** His name is big at the top, next to his photo (or a simple cat-head avatar). The background is a warm cream and there is one line of dry humor in the header: "Don't trust the meows." Everything else is plain and obvious. No mascot animations, no cutesy error messages.
- **Light and dark mode** follow the system automatically (`prefers-color-scheme`), with no in-app toggle. Set `color-scheme: light dark` and add a `theme-color` meta tag for each scheme.
- **Desktop** gets the same single column, centered, no wider than 440 px. There is no separate desktop layout.
- **Colors carry meaning.** Teal means ready or normal. Red is used only for warnings (armed, daily limit reached, not saved). Orange appears only as the decorative ring around Pumo's avatar.

## 2. Visual system

### Color tokens (define on `:root` and swap under `@media (prefers-color-scheme: dark)`)
| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#FBF7F2` | `#1A1614` | Page background |
| `--surface` | `#FFFFFF` | `#27211E` | Rows, cards, outlined button fill |
| `--text` | `#2A211C` | `#F4EEE8` | Main text |
| `--muted` | `#6B5D54` | `#B8ABA1` | "by Sam", tagline, secondary text |
| `--border` | `#8C7B70` | `#7A6B62` | Input borders, meaningful outlines |
| `--divider` | `#EDE4DB` | `#3A322E` | Decorative row dividers only |
| `--accent` | `#0B6B66` | `#5FC9BF` | Primary button fill, links, focus ring, outlined-button border and text |
| `--on-accent` | `#FFFFFF` | `#1A1614` | Text on `--accent` |
| `--warn-text` | `#A3200F` | `#FFA59C` | Warning text and icons |
| `--warn-fill` | `#A3200F` | `#FF8A7F` | Armed button fill |
| `--on-warn` | `#FFFFFF` | `#1A1614` | Text on `--warn-fill` |
| `--warn-soft` | `#FDECEA` | `#3B1A16` | Warning counter pill, not-saved button, error panels |
| `--pumo` | `#E8833A` | `#E8833A` | Avatar ring only, never text |

### Measured contrast (WCAG 2.1)
| Pair | Light | Dark |
|---|---|---|
| text on bg | 14.77 | 15.61 |
| text on surface | 15.76 | 13.79 |
| muted on bg | 5.93 | 8.02 |
| muted on surface | 6.33 | 7.09 |
| on-accent on accent | 6.35 | 9.06 |
| accent on surface | 6.35 | 8.01 |
| accent on bg | 5.95 | 9.06 |
| warn-text on warn-soft | 6.63 | 8.26 |
| warn-text on surface | 7.58 | 8.40 |
| on-warn on warn-fill | 7.58 | 7.87 |
| muted on warn-soft | 5.53 | n/a |
| border vs surface (UI boundary, needs 3:1 or more) | 4.05 | 3.11 |

If a color changes during the build, re-measure it. Text needs at least 4.5:1, and UI boundaries and large text need at least 3:1.

### Type
- Font stack: `ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. This gives iPhones a rounded face and downloads no web fonts.
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

### 3.1 Layout, top to bottom
```
┌─────────────────────────────────────┐
│ [refresh-error banner, only if any] │
│ (◉) Pumo                            │  header: 48px avatar with --pumo ring,
│     Don't trust the meows.          │  h1 "Pumo", muted tagline
│                                     │
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
The target heights are chosen so everything down to the Log button fits in 375×553, and the history link also fits in 390×664 (AC-2.3). If it doesn't fit, shrink vertical gaps first, then the avatar (down to 40 px). Never shrink the button below 64 px or the rows below 56 px.

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
│ ‹ Pumo                              │  back link to index.html, 44px
│ Feed history                        │  h1
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
- It is a plain list: `<section>` per day, `<h2>` heading, `<ul>` of rows. Headings don't stick.
- Delete confirmation works exactly as on home (§3.6), and the consequence text uses the loaded history data.
- There is no Log button on this screen.

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
| Pumo photo | Optional | Dathan puts a photo at `docs/assets/pumo.jpg` before the build | The build center-crops it to a square, resizes to 256×256, strips EXIF (phone photos can carry GPS location), keeps it under 100 KB and saves it as `frontend/assets/pumo.jpg`. Shown as a 48 px circle with a 2 px `--pumo` ring. |
| Avatar fallback | Required | Build agent | `frontend/assets/icon.svg`, the same drawing as the app icon, used when there is no photo. |
| App icon | Required | Build agent draws it. Dathan may optionally supply a Canva design at `docs/assets/icon.png` (512×512 PNG), which then takes priority. | `frontend/assets/icon.svg` in a 512×512 viewBox: a `--accent` (`#0B6B66`) rounded square (rx 112) with a simple cream (`#FBF7F2`) cat head (a wide ellipse with two triangle ears) and two small teal eye dots. No text and no emoji, so it renders identically everywhere. |
| Favicons | Required | Generated from the icon | `<link rel="icon" type="image/svg+xml" href="assets/icon.svg">`, plus `assets/favicon-32.png` (32×32) as a PNG fallback. |
| Apple touch icon | Required | Generated from the icon | `assets/apple-touch-icon.png`, 180×180, opaque background, linked with `<link rel="apple-touch-icon">`. |
| Icons inside the UI | Required | Inline SVG in the HTML or JS | Trash, warning triangle, check, chevron, spinner. No icon font. |

Missing assets never block the build. With no photo, use the SVG avatar. With no Canva icon, use the drawn SVG.
