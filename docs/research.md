# Research — Pumo Feed Log

Date: 2026-09-16

## Idea

One NTAG213 NFC sticker on Pumo's food container. Tapping it with any phone opens a tiny mobile web app showing the last 3 feeds, a one-tap "Log a feed" button, a link to full history, and (nice-to-have) a "3 of 4 today" counter. Shared backend required — 4 household phones must see the same data. Dathan also wants undo and delete for past entries.

## Market scan (light)

**The exact combination (NFC tap → shared multi-user feed log) has real prior art, but nothing polished or off-the-shelf.**

- **[feed-the-dog](https://github.com/technosophos/feed-the-dog)** — the closest direct precedent. NFC sticker on a dog food bin, tapped phone triggers an iPhone Shortcut that hits a cloud backend (Fermyon Spin + shared key-value store), logs the feed, shows a daily count. Same core mechanic as Pumo Feed Log. It's an unmaintained hobby/blog-post project with no delete/undo and no day-grouped history — Dathan's version would be a strict superset.
- General "NFC for household automation" is a known DIY trend (MakeUseOf, XDA, TikTok creators tagging chores), but these are single-user Shortcuts automations, not shared multi-person logs.
- **Dedicated pet-feeding tracker apps** are a saturated free/freemium category: Who Fed The Dog?, I Fed the Pet, Pawfolio, Nomi, Fed?, Chonk. "Who Fed The Dog?" is the closest — it supports multi-user household sharing — but **none of them use an NFC tap as input**; all require opening the app, finding it, and navigating a UI.

**Verdict: crowded-but-beatable on one specific point.** The pet-tracker category itself isn't a gap — it's saturated with free apps that already solve "who fed the pet." But the NFC-tap-to-log mechanic (zero app-hunting, zero login, one physical tap) has exactly one public precedent, and nobody has packaged it as a simple, install-free web app. This is a well-scoped weekend build, not groundbreaking — but it isn't "already solved for free" either, since no ready-made tool does this exact thing.

## Build scan

**NFC mechanics:** NTAG213 tags are programmed with a URL via the free **NFC Tools** app (~30 seconds, write a URL/NDEF record). Tags cost ~$0.30–$1 each. Metal food containers block ordinary tags — an **on-metal NFC tag** is needed if the container itself is metal (mounting on a plastic lid/scoop avoids this).

**iOS vs Android tap behavior:** iPhone (iOS 12+ / XS+) opens the link via Background Tag Reading with no app installed, but the phone must have been unlocked once since restart, Airplane Mode off, no active NFC/Pay session — and the user must tap a pop-up banner (not fully silent). Android generally opens the browser directly, no confirmation tap needed — a smoother experience.

**Hosting:** Cloudflare Pages or GitHub Pages (both free, static). A minimal PWA (manifest + icon) is worth adding so the app has a real name/icon if bookmarked; a full offline service worker isn't needed since the point is live shared data.

**Backend comparison — the central decision:**

| | Supabase | Cloudflare Workers + D1 | Google Sheets + Apps Script |
|---|---|---|---|
| Free tier | 500MB DB, unlimited API requests, 5GB egress, realtime up to 200 concurrent connections | 5GB storage, 5M row reads/day, 100k row writes/day, 100k Worker requests/day (limits now hard-enforced as of Sept 2026) | 6-min max execution, 30 simultaneous executions/user |
| Backend code needed | **None** — PostgREST auto-generates the REST API | **Yes** — you write every route (GET/POST/DELETE), SQL, and CORS handling yourself | **Yes** — you write doGet/doPost, manage LockService for concurrent-write safety |
| Manual setup steps | ~7 (account, org, project, create table, RLS policies, copy URL/key) | ~5 CLI/account steps + writing/deploying a full Worker script | ~8 (create sheet, write code, deploy as web app, set permissions, click through unverified-app warning) |
| Delete/undo | **Excellent** — real row IDs, plain `DELETE` REST call | Good, but manual — you write the route yourself | **Awkward** — no native row ID; `deleteRow()` by index is fragile with near-simultaneous edits |
| Known gotchas | RLS policy misconfiguration blocking inserts is the #1 beginner issue | No auto-API; real code to maintain | Editing code later requires a new deployment version or the live URL keeps running old code (well-known trap); noticeable request latency |
| Inactivity risk | Project pauses after 7 days idle (1-click unpause, no data loss) | None | None |
| Claude/MCP support | **Official Supabase MCP connector** — Claude can create the project, table, and RLS policies conversationally | Official Cloudflare MCP server, but still requires writing Worker code | No official MCP |

**Recommendation: Supabase.** Zero required backend code, native realtime push for instant cross-phone updates without polling, trivial and safe row-level delete/undo, and an official MCP connector that removes most of the setup friction for an AI-driven build. The only real risk (weekly pause on inactivity) is moot for a log used multiple times a day, and is fully mitigated by a scheduled keep-alive ping if needed. Cloudflare D1 has a more durable free tier but demands real coding and has no built-in realtime — unnecessary complexity here. Google Sheets is the worst fit specifically for the delete/undo requirement, plus the redeploy trap makes iteration annoying.

## Sources

- https://github.com/technosophos/feed-the-dog
- https://play.google.com/store/apps/details?id=com.whofedthedog.app
- https://apps.apple.com/us/app/i-fed-the-pet-feed-tracker/id6762333960
- https://apps.apple.com/us/app/pawfolio-pet-feeding-tracker/id6743056578
- https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading
- https://gototags.com/help/ios/nfc/reading/background
- https://supabase.com/pricing
- https://github.com/orgs/supabase/discussions/1548
- https://supabase.com/blog/supabase-is-now-an-official-claude-connector
- https://supabase.com/docs/guides/ai-tools/mcp
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/
- https://github.com/cloudflare/mcp-server-cloudflare
- https://developers.google.com/apps-script/guides/services/quotas
- https://developers.google.com/apps-script/reference/lock
- https://developers.google.com/apps-script/concepts/deployments
