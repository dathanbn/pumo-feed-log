# Pumo Feed Log: architecture

## 1. Stack (decisions)

| Layer | Decision | Why |
|---|---|---|
| Frontend | **Static HTML + CSS + vanilla JavaScript ES modules. No framework, no bundler, no build step, no npm runtime dependencies.** This is a deliberate choice. | The app is two pages, one button, one list and four REST calls. A framework would add a toolchain and nothing else. Files deploy exactly as written. |
| Data access | **Plain `fetch` against Supabase's auto-generated REST API (PostgREST).** No supabase-js. | Four calls are easy to write and to review in `contract.md`, and there's no CDN dependency. supabase-js can be added later if realtime push is built. |
| Backend service | **Supabase is the only external service**: Postgres plus PostgREST, with Row Level Security, on the free tier. | No backend code. The table, grants and policies are the whole backend. |
| Hosting | **Cloudflare Pages (default) or GitHub Pages**, chosen in §8. Both serve the `frontend/` folder as static files over HTTPS. | Free and auto-deploy on push to `main`. |
| Tests | Node's built-in test runner (`node --test`) for pure logic. Playwright (Chromium) for QA end to end, plus `@axe-core/playwright`. | These are dev-only tools and never ship to users. |
| Browser support | iOS Safari 16+, Chrome for Android 110+, current desktop browsers. | Covers every household phone that can read NFC. |

## 2. How the pieces connect
```
[NTAG213 sticker] --NDEF URL--> [phone browser]
                                    │  GET static files (HTML/CSS/JS/icons)
                                    ▼
             Cloudflare Pages or GitHub Pages  ◄── auto-deploy ──  GitHub repo (main, frontend/)
                                    │
                                    │  HTTPS fetch, header  apikey: <publishable key>
                                    ▼
          Supabase PostgREST  /rest/v1/feeds  ──►  Postgres table public.feeds
                                                   (RLS on, anon: select / insert(id, logged_by) /
                                                    update(deleted_at), no delete)
```
The browser talks to Supabase directly, with no server in between. The publishable key is meant to be public, so it sits in the frontend code, and the table's grants and policies decide what it can do.

## 3. File layout
```
pumo-feed-log/                     (GitHub repo root)
├── docs/                          Dathan's approved spec. Build agents read it and don't edit it,
│   │                              except for §8 of this file on the MCP path.
│   ├── spec.md
│   ├── design.md
│   ├── architecture.md
│   ├── contract.md
│   ├── tasks.md
│   └── assets/                    optional, from Dathan: pumo.jpg, icon.png
├── frontend/                      the deployed site root (everything here is public)
│   ├── index.html                 home screen
│   ├── history.html               full history
│   ├── build.txt                  one line: ISO timestamp of the latest build commit
│   ├── css/styles.css
│   ├── js/config.js               SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PUMO_PHOTO_URL
│   ├── js/constants.js            exactly contract.md §7.1
│   ├── js/logic.js                pure functions only (no DOM, no fetch, no storage)
│   ├── js/api.js                  the only module that talks to Supabase
│   ├── js/storage.js              localStorage name helpers, every access in try/catch
│   ├── js/ui.js                   shared DOM helpers: status region, focus refresh, row + delete confirm
│   ├── js/home.js                 home screen controller (button state machine)
│   ├── js/history.js              history screen controller
│   └── assets/                    icon.svg, favicon-32.png, apple-touch-icon.png, pumo.jpg (optional)
├── backend/
│   └── schema.sql                 the complete Supabase setup SQL (identical to contract.md §2)
├── tests/
│   ├── unit/                      frontend agent: logic.test.mjs (node --test)
│   ├── e2e/                       QA agent: Playwright scripts
│   ├── screenshots/               QA agent
│   └── qa-report.md               QA agent
└── .github/workflows/deploy-pages.yml   only if HOSTING = github-pages
```

**About `backend/`:** there is no server code, and there never will be for v1. `backend/` exists only to hold `schema.sql`, which is the versioned, re-runnable definition of the database. That keeps the database's source of truth next to where a backend would normally live. Nothing else goes in `backend/`: no package.json, no functions, no Edge Functions.

All paths inside `frontend/` are **relative** (`css/styles.css`, never `/css/styles.css`). The same files then work at a domain root (Cloudflare) and under `/pumo-feed-log/` (GitHub Pages).

## 4. Module responsibilities and core flow

| Module | Owns | Must not |
|---|---|---|
| `config.js` | The three config values | Contain the secret key or DB password, ever |
| `constants.js` | Every number and storage key in contract.md §7.1 | Be duplicated as literals anywhere else |
| `logic.js` | `startOfLocalDay`, `formatRelative`, `formatFeedLabel`, `formatDayHeading`, `guardState`, `armedLabel`, `deleteConsequence`, `groupByDay`, `sanitizeName`, `newFeedId` | Touch the DOM, network, clock (`now` is always passed in) or storage |
| `api.js` | `getHomeData`, `logFeed`, `softDeleteFeed`, `getHistoryPage`, timeouts, error normalization (contract.md §6 and §8) | Know about UI state. Send `created_at`. Use the HTTP `DELETE` method |
| `storage.js` | `getName`, `setName`, `isNamePromptDone`, `setNamePromptDone` | Store anything about feeds |
| `ui.js` | `announce(text)`, `onFocusRefresh(cb)` (listens for `visibilitychange`→visible, `focus`, `pageshow`, debounced by `FOCUS_REFRESH_DEBOUNCE_MS`, skipped while a load is in flight), the shared row renderer with inline delete confirmation, error panel and banner | Insert user text with `innerHTML` (always use `textContent`) |
| `home.js` | Home state, the 30 s tick, the Log button state machine, undo notice, name card | |
| `history.js` | History state, paging, day groups | |

### Home state (in memory only)
```
{ recent: Feed[≤3], todayCount, loadedAt, loadedDayKey, loadStatus: 'loading'|'ready'|'error',
  button: 'loading'|'ready'|'guarded'|'checking'|'armed'|'saving'|'logged'|'not-saved'|'load-failed',
  pendingLog: {id, logged_by} | null, armTimer, undo: {feed, expiresAt, status} | null,
  confirmingDeleteId, consecutiveFailures }
```

### Log button flow (the heart of the app)
```
onLogTap():
  if button in ['loading','checking','saving','logged']: ignore
  if button == 'load-failed': refresh(); return
  if button == 'armed': clearArmTimer(); save(newAttempt()); return
  if button == 'not-saved' and pendingLog: save(pendingLog); return      # same id, no re-guard
  # 'ready', 'guarded', or 'not-saved' caused by a failed freshness check:
  if now - loadedAt > STALE_AFTER_MS:
      button = 'checking'
      ok = await refresh()
      if !ok: button = 'not-saved'; pendingLog = null; return
  g = guardState(now, recent[0], todayCount)
  if g.guarded: button = 'armed'; label = armedLabel(g, now); start ARM_TIMEOUT_MS timer → back to 'guarded'; return
  save(newAttempt())

newAttempt() = { id: newFeedId(), logged_by: storage.getName() }   # null if no name

save(attempt):
  pendingLog = attempt; button = 'saving'
  try  row = await api.logFeed(attempt)
       pendingLog = null; put row at top of recent (keep 3); if row is today: todayCount++
       button = 'logged' for LOGGED_FLASH_MS, then recompute ready/guarded
       show undo notice for row (UNDO_WINDOW_MS); announce; vibrate(30)
       refresh() in background (on failure: stay silent, keep local state)
  catch → button = 'not-saved'; consecutiveFailures++
```
- **Page hidden while armed:** revert to `guarded` immediately.
- **Every `TICK_MS`:** re-render relative labels and recompute `ready` or `guarded`. If the local date differs from `loadedDayKey`, call `refresh()`.
- **Undo and delete** both call `api.softDeleteFeed(id)`, then `refresh()`.

## 5. Agent work split for the build

| Agent | Exists? | Scope |
|---|---|---|
| **Frontend agent** | Yes | Everything buildable: the one-time Supabase setup (applying `backend/schema.sql` via MCP, or checking Dathan's manual setup), all of `frontend/`, `tests/unit/`, the icons, and deploy. |
| **Backend agent** | **No** | There's no server code to write. The backend is ~25 lines of SQL applied once. A separate agent would add a handoff and give the same four REST calls a second owner, with no parallel work to show for it. The setup is folded into the frontend agent's Task 1 (see tasks.md). |
| **QA agent** | Yes | Checks every [QA] criterion in spec.md against the real Supabase project and the real deploy, captures every state in design.md §6, takes screenshots and writes `tests/qa-report.md`. |

## 6. Deploy

- **Cloudflare Pages (default):** once Dathan connects the repo (§7 step 7A), every push to `main` deploys `frontend/` to LIVE_URL within about a minute. Pushes to other branches get preview URLs of the form `https://<branch-alias>.<project>.pages.dev`.
- **GitHub Pages:** the frontend agent adds `.github/workflows/deploy-pages.yml`, which on push to `main` uploads `frontend/` with `actions/upload-pages-artifact` and publishes it with `actions/deploy-pages`. Use the current major versions of the actions.
- **Build marker:** `frontend/build.txt` is updated on every build commit. QA compares `LIVE_URL/build.txt` with the repo copy to confirm the deploy is current.

## 7. Manual setup — before the build starts

Do these in order. Hands-on time is roughly 30–45 minutes. **Order the stickers (step 5) first**, because shipping is the only slow part and everything else can happen while you wait.

### Step 1: Create a free Supabase account and project
*(If you're taking the connector route in step 4, do only 1.1 and 1.2, then skip to step 4.)*

1. Go to **https://supabase.com/dashboard** and sign up. Signing in with GitHub is fine. It's free, with no card.
2. If it asks you to create an organization, give it any name, choose type **Personal** and plan **Free**.
3. Click **New project** and fill in:
   - **Project name:** `pumo-feed-log`
   - **Database password:** click **Generate a password**, then save it in your password manager (or somewhere safe) right away. The app never uses it, and Supabase won't show it again, but you'll want it if you ever connect a database tool.
   - **Region:** the one nearest your home. If it only asks for a broad area, pick **Americas**.
   - If the form shows security or Data API options, leave **Enable Data API** checked. "Automatically expose new tables" can go either way, because step 2's SQL sets permissions explicitly.
4. Click **Create new project** and wait about 2 minutes, until the dashboard stops saying it's setting up.
5. The free plan allows 2 active projects. If creating one fails because you already have 2, pause one of the others first.

### Step 2: Create the `feeds` table, turn on RLS, add policies
1. In the project's left sidebar, open **SQL Editor** and start a **New query**.
2. Paste **all** of the SQL below and click **Run**. You should see "Success. No rows returned". The SQL is safe to run again if you're unsure.

```sql
-- Pumo Feed Log: complete database setup (Supabase / Postgres). Safe to re-run.

create table if not exists public.feeds (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  logged_by   text        null,
  deleted_at  timestamptz null
);

comment on table public.feeds is
  'Pumo Feed Log. One row per feed. Soft delete only: deleted_at not null means deleted.';

-- Row Level Security on.
alter table public.feeds enable row level security;

-- Table privileges. Newer Supabase projects no longer grant these automatically, so set them explicitly.
revoke all on table public.feeds from anon, authenticated;
grant usage on schema public to anon;
grant select on table public.feeds to anon;                  -- anyone with the link can read
grant insert (id, logged_by) on table public.feeds to anon;  -- created_at is always the server's now()
grant update (deleted_at) on table public.feeds to anon;     -- the only edit allowed is soft delete
-- Deliberately no DELETE grant: rows can never be hard-deleted through the API.

-- Permissive RLS policies for the anon role.
drop policy if exists feeds_anon_select on public.feeds;
create policy feeds_anon_select on public.feeds for select to anon using (true);

drop policy if exists feeds_anon_insert on public.feeds;
create policy feeds_anon_insert on public.feeds for insert to anon with check (true);

drop policy if exists feeds_anon_update on public.feeds;
create policy feeds_anon_update on public.feeds for update to anon using (true) with check (true);
-- Deliberately no DELETE policy.
```

3. Check it worked by running these two queries in a new SQL Editor tab:
   - `select policyname, cmd from pg_policies where tablename = 'feeds';` should return **3 rows** (SELECT, INSERT, UPDATE).
   - `select privilege_type, column_name from information_schema.column_privileges where table_name = 'feeds' and grantee = 'anon' order by 1, 2;` should list INSERT on `id` and `logged_by`, SELECT on all 4 columns, and UPDATE on `deleted_at` only.
4. **Why permissive policies are fine here:** this is a private in-home tool with no sensitive data (feed times and first names), and deletes are soft. So "anyone with the link can read, log and soft-delete" is exactly the intended behavior. The grants still block hard deletes and backdated timestamps.

### Step 3: Copy the Project URL and the API key
1. On the project's home page, click **Connect** at the top. It shows the Project URL and the key together. You can also find them in **Project Settings → API Keys** (the key) and **Project Settings → Data API** (the URL).
2. Copy the **Project URL**. It looks like `https://abcdefghijklmnop.supabase.co`.
3. Copy the **Publishable key**, which starts with `sb_publishable_`. Supabase renamed the old "anon public" key to "publishable key", and projects created since November 2025 only have the new one. If your dashboard only shows a legacy **anon public** key (a long string starting `eyJ`), use that instead. It works the same way.
4. **Don't** copy the **secret** key (`sb_secret_…`) or any `service_role` key. Neither ever goes into the app or the repo.
5. Paste both values into the table in §8.

### Step 4: Lower-effort alternative to steps 1–3: let the build agent do it through the Supabase connector
Either path is fine: doing steps 1–3 by hand, or this one. With this path the build agent creates the project, runs the SQL and fetches the URL and key itself.
1. Do steps 1.1–1.2 only (sign up). The connector signs in as you, so the account must exist.
2. Connect the **official Supabase MCP connector** before starting the build:
   - **Claude app (web or desktop):** Settings → Connectors → find **Supabase** → Connect → sign in to Supabase → allow access to your organization.
   - **Claude Code:** run `claude mcp add --transport http supabase https://mcp.supabase.com/mcp`, then run `/mcp` inside Claude Code and finish the Supabase sign-in in the browser.
   - Don't turn on read-only mode, because the agent must create the table. Don't limit the connection to one project, because the project doesn't exist yet.
3. In §8, set `SUPABASE_SETUP_PATH` to `mcp`, leave the URL and key blank, and optionally fill in `SUPABASE_REGION`.
4. The frontend agent will then:
   - create project `pumo-feed-log` on the Free plan, confirming the $0 cost,
   - run the step 2 SQL,
   - fetch the Project URL and publishable key and write them into §8 and `frontend/js/config.js`.
   If the tool needs a database password, the agent generates a random one and doesn't keep it. You can set your own anytime under Project Settings → Database → Reset database password. The app never needs it.
5. The same 2-active-projects limit from step 1.5 applies.

### Step 5: Buy NFC stickers
1. On Amazon, search **"NTAG213 NFC stickers"**. Packs of 10–50 cost about **$0.30–$1 per sticker**. Round 25–30 mm stickers are the easiest to hit with a phone. NTAG215 or NTAG216 also work, but are unnecessary.
2. **If the sticker will sit on metal** (a metal tin, lid or scoop), buy stickers labeled **"on-metal"** or **"anti-metal" NTAG213** specifically. Ordinary stickers won't read on metal.
3. Get a pack with spares: one to practice writing on, and backups.

### Step 6: Install NFC Tools on one phone
1. Install the free **NFC Tools** app by **wakdev**, from the App Store (iPhone 7 or newer) or Google Play (Android with NFC).
2. Only the phone that will program the sticker needs it. Nobody needs it to *use* the sticker.

### Step 7: GitHub account and hosting (a small either/or choice, not a blocker)
**For both options:**
1. Sign up or sign in at **https://github.com**.
2. Create a new repository named `pumo-feed-log` and tick **Add a README**, so a `main` branch exists.
   - Visibility: **Private** is fine for Cloudflare Pages. It must be **Public** for GitHub Pages on a free account. The publishable key being visible is expected either way.
3. Add the five spec files to a `docs/` folder in the repo and commit them to `main`.
4. Make sure the build session can **push** to this repo. In Claude Code on the web, choose this repo when you start the session. In local Claude Code, run `gh auth login` first.
5. If the build runs in a sandboxed environment with a network allowlist, allow `github.com`, `*.supabase.co`, and `*.pages.dev` (or `*.github.io`).

**Option A: Cloudflare Pages (the default)**
1. Sign up free at **https://dash.cloudflare.com**.
2. Go to **Workers & Pages → Create application → Pages → Connect to Git**. If the screen opens on Workers, switch to the Pages option.
3. Authorize GitHub and grant access to the `pumo-feed-log` repo only.
4. Fill in the build settings:
   - **Project name:** `pumo-feed-log`
   - **Production branch:** `main`
   - **Framework preset:** None
   - **Build command:** leave empty
   - **Build output directory:** `frontend`
   - **Root directory:** leave empty
5. Click **Save and Deploy**. **The first deploy will fail or be empty because `frontend/` doesn't exist yet. That's expected.** Once the build pushes, every push to `main` redeploys automatically.
6. Copy the URL Cloudflare shows, such as `https://pumo-feed-log.pages.dev` (it may have a suffix if that name is taken), into `LIVE_URL` in §8.

**Option B: GitHub Pages (stay in one ecosystem)**
1. The repo must be **Public**.
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. That's all. The build adds the workflow file.
3. Set `LIVE_URL` to `https://<your-github-username>.github.io/pumo-feed-log/` in §8.

### Step 8: Fill in the setup values, add optional assets, start the build
1. Fill in the table in §8 of this file (`docs/architecture.md`) and commit it.
2. Optional: add a photo of Pumo's face (square-ish, at least 256×256) as `docs/assets/pumo.jpg`.
3. Optional: add a 512×512 PNG app icon (for example made in Canva) as `docs/assets/icon.png`. If you skip it, the build draws a simple cat-head icon.
4. Start the build (agent-team-app-builder) and point it at `docs/`.

### Step 9: After the build is deployed, program and place the tag
**This has to come last.** The sticker only stores the app's URL, which doesn't exist until the app is live.
1. Open LIVE_URL on your phone and confirm the app loads.
2. Open **NFC Tools** and go to **Write → Add a record → URL / URI**. Select the `https://` prefix, type the rest of LIVE_URL exactly, and tap **OK**.
3. Tap **Write**. Hold the top edge of an iPhone, or the middle of the back of an Android phone, flat against the sticker until you see **Write complete**.
4. Check it: in NFC Tools, go to **Read** and tap the sticker. It should show exactly one URL record with LIVE_URL.
5. Stick it in its final spot, somewhere a phone can reach flat with nothing metal in between (unless it's an on-metal sticker).
6. Test on all 4 phones:
   - **iPhone:** awake and unlocked, hold the top edge to the sticker, then tap the banner.
   - **Android:** unlocked with NFC on, hold the back to the sticker.
7. **Don't** use NFC Tools' "Lock tag" option. Locking is permanent, and leaving the tag unlocked lets you rewrite it if the URL ever changes.
8. Work through the "Dathan's post-deploy checklist" in `tests/qa-report.md`.

## 8. Setup values (Dathan fills in before the build)

| Key | Value | Notes |
|---|---|---|
| `SUPABASE_SETUP_PATH` | `mcp` | Project + schema created via the Supabase MCP connector |
| `SUPABASE_URL` | `https://dufyzxtrhdcwrebagsfs.supabase.co` | |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_1UHmmXOcj6uhnQJRSFKMEQ_qjOzVwJl` | |
| `SUPABASE_REGION` | `us-east-2` | |
| `HOSTING` | `github-pages` | Repo is public; GitHub Actions set as the Pages source |
| `GITHUB_REPO` | `https://github.com/dathanbn/pumo-feed-log` | |
| `LIVE_URL` | `https://dathanbn.github.io/pumo-feed-log/` | |
| `PUMO_PHOTO` | `none` | `docs/assets/pumo.jpg` or `none` |
| `CUSTOM_ICON` | `none` | `docs/assets/icon.png` or `none` |

## 9. Operating notes (for Dathan, after launch)

- **Project paused** (free tier, after 7 days with no activity): open the Supabase dashboard, select the project and click **Restore** or **Unpause**. No data is lost. Normal daily use keeps it awake.
- **Restoring a deleted feed** (there's no in-app restore in v1): in the SQL Editor, run `select id, created_at, logged_by, deleted_at from public.feeds where deleted_at is not null order by deleted_at desc limit 20;`, then `update public.feeds set deleted_at = null where id = '<id>';`.
- **Clearing build and QA test rows before real use (optional):** `delete from public.feeds where logged_by in ('Build-test', 'QA-test');`. This runs as the dashboard's admin role. The app itself can never hard-delete.
- **Changing the 2-hour window or the daily target:** edit `frontend/js/constants.js` and push.
- **"Couldn't find the table" right after setup:** run `notify pgrst, 'reload schema';` in the SQL Editor.
- **The URL changed:** rewrite the sticker with NFC Tools (step 9.2–9.4).
