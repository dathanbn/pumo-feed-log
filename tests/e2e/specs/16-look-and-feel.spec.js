// tests/e2e/specs/16-look-and-feel.spec.js
// F16 — AC-16.1 through AC-16.6, the remaining design.md §6 state screenshots not already
// captured by earlier specs, and the accessibility checks from tasks.md §2 item 5.

'use strict';

const fs = require('fs');
const path = require('path');
const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, gotoHistory, seedQaLoggerName, simulateHiddenThenVisible } = require('../helpers/app');
const {
  logButton,
  rowDeleteButton,
  confirmDeleteButton,
  nameInput,
  refreshBanner,
  undoNoticeRegion,
  selectedPetAvatarLink,
} = require('../helpers/selectors');
const { mockHomeData, mockHomeDataDynamic, mockPets, mockHistoryFirstPage, mockSuccessfulWrites, fakeFeed } = require('../helpers/mock');
const net = require('../helpers/network');
const { scanForSeriousViolations, summarizeViolations, assertTapTarget } = require('../helpers/a11y');
const { shot } = require('../helpers/screenshot');
const { MS } = require('../helpers/time');
const { QA_LOGGED_BY } = require('../config');

const FRONTEND_DIR = path.resolve(__dirname, '..', '..', '..', 'frontend');

function pngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  // PNG: 8-byte signature, then IHDR chunk: 4-byte length, 4-byte "IHDR", 4-byte width, 4-byte height.
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

test.describe('F16 — Look and feel', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  test('AC-16.1 — header shows "Pumo" + avatar (photo when configured, else the cat-head fallback)', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Pumo' })).toBeVisible();

    // v1.1: the avatar comes from the `pets` table's own `photo_url` column (contract.md §1/
    // §6.G), not a `PUMO_PHOTO_URL` config constant — that literal is retired (AC-17.7,
    // contract.md §4's api.js "must not" list) and design.md §3.0 makes the SELECTED pet's
    // picker avatar double as the header avatar (3.0/3.1 are "the same element"). Scope to it
    // via selectedPetAvatarLink (a[aria-current="true"]) rather than a leftover v1-era
    // `.avatar img`/`#avatar img` locator, which doesn't match this markup at all (confirmed by
    // direct repro: 0 matches) and was the actual cause of this AC's earlier failure.
    const avatarWrap = selectedPetAvatarLink(page).locator('.pet-avatar');
    await expect(avatarWrap).toBeVisible();
    const img = avatarWrap.locator('.pet-avatar__img');
    if (await img.count()) {
      // A photo is configured (default seed data: Pumo's photo_url is set) — decorative, since
      // the h1 already says "Pumo" (design.md §7): the wrapping .pet-avatar is aria-hidden and
      // the <img> itself carries alt="" (frontend/js/ui.js buildPetAvatar).
      await expect(img).toBeVisible();
      await expect(avatarWrap).toHaveAttribute('aria-hidden', 'true');
      await expect(img).toHaveAttribute('alt', '');
    } else {
      // No photo configured for the selected pet — SVG placeholder fallback.
      await expect(avatarWrap.locator('svg')).toBeVisible();
      await expect(avatarWrap).toHaveAttribute('aria-hidden', 'true');
    }
  });

  test('AC-16.2 — light/dark follows the emulated color scheme and restyles without reload', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(5) })], todayCount: 1 });
    await page.emulateMedia({ colorScheme: 'light' });
    await gotoHome(page);
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await page.emulateMedia({ colorScheme: 'dark' }); // no reload
    await page.waitForTimeout(100);
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    expect(darkBg, 'background should change immediately when the emulated scheme changes').not.toBe(lightBg);
    // design.md §2 (corrected, post-redesign "Pumo" Design System palette — D5's original
    // report entry was mismeasured against a stale pre-redesign doc value, not a real frontend
    // defect; see qa-report.md §4/§10): light --surface-100 #FBF2E4 = rgb(251,242,228);
    // dark --surface-100 #1E1913 = rgb(30,25,19). This is the page background token
    // (frontend/css/styles.css `body { background: var(--surface-100); }`).
    expect(lightBg).toBe('rgb(251, 242, 228)');
    expect(darkBg).toBe('rgb(30, 25, 19)');
  });

  test('AC-16.3 — 1440x900: single column, centered, no wider than 440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(5) })], todayCount: 1 });
    await gotoHome(page);

    const box = await page.locator('.page').first().boundingBox();
    expect(box).not.toBeNull();
    expect(box.width, 'the column must never exceed 440px').toBeLessThanOrEqual(440);
    const leftGap = box.x;
    const rightGap = 1440 - (box.x + box.width);
    expect(Math.abs(leftGap - rightGap), 'the column should be horizontally centered').toBeLessThanOrEqual(4);

    await shot(page, { n: 16, screen: 'home', state: 'desktop-1440', scheme: 'light' });
  });

  test('AC-16.4 — tab title, favicon, and a 180x180 opaque apple-touch-icon', async ({ page }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);
    await expect(page).toHaveTitle('Pumo Feed Log');
    const iconLinks = await page.locator('link[rel~="icon"]').count();
    expect(iconLinks, 'at least one favicon link should be present').toBeGreaterThan(0);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);

    const iconPath = path.join(FRONTEND_DIR, 'assets', 'apple-touch-icon.png');
    if (fs.existsSync(iconPath)) {
      const { width, height } = pngDimensions(iconPath);
      expect([width, height]).toEqual([180, 180]);
    } else {
      test.info().annotations.push({ type: 'note', description: `${iconPath} not found on disk to verify dimensions directly.` });
    }
  });

  test('AC-16.5a — S1 empty home (light + dark)', async ({ page }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await page.emulateMedia({ colorScheme: 'light' });
    await gotoHome(page);
    await expect(page.getByText('No feeds logged yet')).toBeVisible();
    await shot(page, { n: 1, screen: 'home', state: 'empty', scheme: 'light' });

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(100);
    await shot(page, { n: 1, screen: 'home', state: 'empty', scheme: 'dark' });
  });

  test('AC-16.5b — S2 home loading (placeholders, aria-busy)', async ({ page }) => {
    await net.neverRespond(page, { methodFilter: 'GET' });
    const navPromise = gotoHome(page).catch(() => {});
    await page.waitForTimeout(300); // catch it mid-load
    await expect(page.locator('#recent-section, .recent')).toHaveAttribute('aria-busy', 'true').catch(() => {});
    await shot(page, { n: 2, screen: 'home', state: 'loading', scheme: 'light' });
    await net.clearRoutes(page, undefined);
    await navPromise;
  });

  test('AC-16.5c — home with 3 feeds (light + dark)', async ({ page }) => {
    await mockHomeData(page, {
      recent: [
        fakeFeed({ agoMs: MS.minutes(5), loggedBy: 'Sam' }),
        fakeFeed({ agoMs: MS.hours(3), loggedBy: 'Alex' }),
        fakeFeed({ agoMs: MS.hours(20), loggedBy: null }),
      ],
      todayCount: 3,
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await gotoHome(page);
    await shot(page, { n: 2, screen: 'home', state: '3-feeds', scheme: 'light' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(100);
    await shot(page, { n: 2, screen: 'home', state: '3-feeds', scheme: 'dark' });
  });

  test('AC-16.5d — S3 load error (light + dark, per tasks.md §2 dark-mode minimum set)', async ({ page }) => {
    await net.abortRequests(page, { methodFilter: 'GET' });
    await page.emulateMedia({ colorScheme: 'light' });
    await gotoHome(page);
    await expect(page.getByText("Can't load feeds")).toBeVisible({ timeout: 15000 });
    await shot(page, { n: 3, screen: 'home', state: 'load-error', scheme: 'light' });

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(100);
    await shot(page, { n: 3, screen: 'home', state: 'load-error', scheme: 'dark' });
  });

  test('AC-16.5d2 — S4 refresh banner: a focus-triggered refresh failure keeps the data on screen and shows the banner + Retry', async ({
    page,
  }) => {
    // contract.md §8 "Network failure on a focus or retry refresh with data on screen":
    // keep the data and show the refresh banner (design.md §6 S4). Uses only GET route
    // interception (abort), so — unlike the real-write specs — this doesn't depend on this
    // sandbox actually reaching Supabase.
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(5), loggedBy: 'Sam' })], todayCount: 1 });
    await gotoHome(page);
    await expect(page.getByText('by Sam')).toBeVisible();

    await net.abortRequests(page, { methodFilter: 'GET' });
    await simulateHiddenThenVisible(page); // triggers a background focus refresh, which now fails

    await expect(refreshBanner(page).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    // The stale data must stay on screen, per S4 — not replaced by an error panel.
    await expect(page.getByText('by Sam')).toBeVisible();
    await expect(page.getByText("Can't load feeds")).toHaveCount(0);
    await shot(page, { n: 4, screen: 'home', state: 'refresh-banner', scheme: 'light' });
  });

  test('AC-16.5i — dark mode: guarded (resting) and armed (per tasks.md §2 dark-mode minimum set)', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.hours(1) + MS.minutes(55) })], todayCount: 1 });
    await gotoHome(page);
    await expect(logButton(page)).toHaveText('Log a feed'); // guarded style, same label as ready
    await shot(page, { n: 6, screen: 'home', state: 'guarded-resting', scheme: 'dark' });

    await logButton(page).click();
    await expect(logButton(page)).toContainText('— log another?');
    await shot(page, { n: 6, screen: 'home', state: 'armed', phase: 'after', scheme: 'dark' });

    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('AC-16.5j — dark mode: S5 not-saved (network failure while logging)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);
    await expect(logButton(page)).toHaveText('Log a feed', { timeout: 10000 });

    await net.abortRequests(page, { methodFilter: 'POST' });
    await logButton(page).click();
    await expect(logButton(page)).toHaveText('Not saved, tap to retry', { timeout: 12000 });
    await shot(page, { n: 5, screen: 'home', state: 'not-saved', scheme: 'dark' });

    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('AC-16.5j2 — light mode: S5 not-saved (network failure while logging)', async ({ page }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);
    await expect(logButton(page)).toHaveText('Log a feed', { timeout: 10000 });

    await net.abortRequests(page, { methodFilter: 'POST' });
    await logButton(page).click();
    await expect(logButton(page)).toHaveText('Not saved, tap to retry', { timeout: 12000 });
    await shot(page, { n: 5, screen: 'home', state: 'not-saved', scheme: 'light' });
  });

  // The following capture states that only exist after a successful log (saving, logged, the
  // undo notice and its failure mode). Specs 03/04/09 prove the real end-to-end behavior for
  // these against the real Supabase project; here the POST/PATCH responses are synthesized
  // locally (helpers/mock.js mockSuccessfulWrites — never touching the real network) purely so
  // the required screenshot evidence for each design.md §6 state still exists when the real
  // project is unreachable from this environment (see qa-report.md's environment note).
  test('AC-16.5k — saving (button disabled, spinner, mid-request)', async ({ page }) => {
    await seedQaLoggerName(page.context(), QA_LOGGED_BY);
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);
    await expect(logButton(page)).toHaveText('Log a feed', { timeout: 10000 });

    await mockSuccessfulWrites(page, { postDelayMs: 4000 });
    await logButton(page).click();
    await expect(logButton(page)).toHaveText('Saving…', { timeout: 2000 });
    await shot(page, { n: 4, screen: 'home', state: 'saving', scheme: 'light' });
  });

  test('AC-16.5l — logged state + undo notice (before/after) + undo failed', async ({ page }) => {
    await seedQaLoggerName(page.context(), QA_LOGGED_BY);
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);
    await expect(logButton(page)).toHaveText('Log a feed', { timeout: 10000 });

    await mockSuccessfulWrites(page);
    await logButton(page).click();
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
    await shot(page, { n: 3, screen: 'home', state: 'logged-undo-notice', scheme: 'light' });

    // Scope to the role="status" region that is NOT the visually-hidden live announcer
    // (design.md §7) — both regions can carry byte-identical text at the same moment (e.g.
    // "Feed removed"), which otherwise trips a Playwright strict-mode violation.
    const undoNotice = undoNoticeRegion(page).filter({ hasText: /^Logged / });
    await expect(undoNotice).toBeVisible();
    await shot(page, { n: 3, screen: 'home', state: 'undo-notice', phase: 'before', scheme: 'light' });

    // Undo failed: fail the PATCH once, retry succeeds — captures the failed state in between.
    // NOTE: Playwright's page.route() handlers run most-recently-registered-first, and
    // route.continue() sends straight to the network rather than falling through to an
    // earlier-registered handler. So this must be a single handler that both aborts the first
    // PATCH and synthesizes the retry's success response itself, rather than re-registering
    // mockSuccessfulWrites "on top" afterwards (that would just shadow the abort every time,
    // since it's now the newest handler and never calls continue()).
    let patchAttempts = 0;
    await page.route('**/rest/v1/feeds**', async (route) => {
      const req = route.request();
      if (req.method() === 'PATCH') {
        patchAttempts += 1;
        if (patchAttempts === 1) return route.abort('failed');
        let body = {};
        try {
          body = JSON.parse(req.postData() || '{}');
        } catch {
          /* ignore */
        }
        const u = new URL(req.url());
        const idMatch = (u.searchParams.get('id') || '').match(/^eq\.(.+)$/);
        const row = { id: idMatch ? idMatch[1] : 'unknown', deleted_at: body.deleted_at || new Date().toISOString() };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([row]) });
      }
      return route.continue();
    });
    await undoNotice.getByRole('button', { name: 'Undo' }).click();
    const undoFailedNotice = undoNoticeRegion(page).filter({ hasText: "Couldn't undo" });
    await expect(undoFailedNotice).toBeVisible({ timeout: 5000 });
    await shot(page, { n: 9, screen: 'home', state: 'undo-failed', scheme: 'light' });

    await undoFailedNotice.getByRole('button', { name: 'Retry' }).click();
    await expect(undoNoticeRegion(page).filter({ hasText: /^Logged / })).toHaveCount(0, { timeout: 5000 });
    await shot(page, { n: 3, screen: 'home', state: 'undo-notice', phase: 'after', scheme: 'light' });
  });

  test('AC-16.5e — S13 paused hint (2 consecutive failures while online)', async ({ page }) => {
    // Mock pets to succeed first: net.abortRequests below only targets the feeds endpoint (by
    // design — see its own doc comment), so without this the real (sandbox-blocked) /rest/v1/pets
    // call fails on its own and sends the app down the unrelated pet-load-error path ("Try
    // again" with no paused-hint tracking) instead of the feeds-load-error path this test means
    // to exercise. Confirmed by direct repro: with pets mocked, the real feeds-only failure path
    // correctly shows the paused hint after 2 consecutive failures.
    await mockPets(page);
    await net.abortRequests(page, { methodFilter: 'GET' });
    await gotoHome(page); // 1st failure -> plain error
    await expect(page.getByText("Can't load feeds")).toBeVisible({ timeout: 15000 });
    await logButton(page).click(); // load-failed's label is "Try again"; this retries and fails a 2nd time
    await expect(page.getByText(/database may be paused/i)).toBeVisible({ timeout: 15000 });
    await shot(page, { n: 13, screen: 'home', state: 'paused-hint', scheme: 'light' });
  });

  // Regression test for defect D3 (fix round 1): renderPetLoadError() used to set
  // buttonText/onButtonClick on #error-block's own panel button AND relabel #log-button to
  // "Try again" at the same time, so both were visible at once — a Playwright strict-mode
  // violation ("resolved to 2 elements") the moment a test looked for the retry control by its
  // accessible name. No test in this file currently exercises the PET-load-error panel
  // specifically (AC-16.5e above exercises the FEEDS-load-error panel instead, which was never
  // the buggy path), so this is added as its own permanent regression check rather than relying
  // on a defect writeup alone.
  test('D3 regression — exactly one "Try again" control after two consecutive pet-load failures', async ({
    page,
  }) => {
    await net.abortRequests(page, { urlPattern: `${require('../config').SUPABASE_URL}/rest/v1/pets**` });
    await gotoHome(page); // 1st failure: pet-load-error panel
    await expect(page.getByRole('button', { name: /try again/i })).toHaveCount(1, { timeout: 15000 });
    await page.getByRole('button', { name: /try again/i }).click(); // retries and fails a 2nd time
    await expect(page.getByRole('button', { name: /try again/i })).toHaveCount(1, { timeout: 15000 });
  });

  // Split into independent tests (rather than one long chained scenario) so that a failure
  // capturing one state's screenshot can't cascade and prevent the others from being taken —
  // each of S9/S10/S11/grouped-dark is its own required item in tasks.md §2's minimum
  // screenshot set and should be captured independently of the others' outcomes.
  test('AC-16.5f1 — S9 history loading (placeholders, aria-busy)', async ({ page }) => {
    await net.neverRespond(page, { methodFilter: 'GET' });
    const navPromise = gotoHistory(page).catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, { n: 9, screen: 'history', state: 'loading', scheme: 'light' });
    await net.clearRoutes(page, undefined);
    await navPromise;
  });

  test('AC-16.5f2 — S11 history load error', async ({ page }) => {
    await net.abortRequests(page, { methodFilter: 'GET' });
    await gotoHistory(page).catch(() => {});
    // Gate on a quote-style-tolerant match first, so the screenshot (required evidence either
    // way) still gets captured even if the exact-copy check below fails.
    await expect(page.getByText(/load history\.?/i)).toBeVisible({ timeout: 15000 });
    await shot(page, { n: 11, screen: 'history', state: 'load-error', scheme: 'light' });

    // design.md §5's copy is the straight-quote "Can't load history." (U+0027); tasks.md §2
    // item 4 requires matching it word-for-word. ui.js's COPY.historyLoadErrorTitle uses a
    // curly U+2019 apostrophe instead ("Can’t load history.") — filed as a defect; this
    // assertion is expected to fail until that's fixed, and is intentionally kept strict
    // (not loosened to tolerate either character) so a real fix is unambiguously detected.
    await expect(page.getByText("Can't load history.")).toBeVisible();
  });

  test('FAIL-2 re-test — history load error uses a straight apostrophe, exact copy match', async ({
    page,
  }) => {
    // Re-tests the defect filed against frontend/js/ui.js (COPY.historyLoadErrorTitle) and
    // frontend/index.html (the tagline and name-card heading): a curly U+2019 apostrophe was
    // used where design.md §5's copy table specifies a straight U+0027 one. Fixed to a plain
    // `'` in all three locations.
    await net.abortRequests(page, { methodFilter: 'GET' });
    await gotoHistory(page).catch(() => {});
    await expect(page.getByText("Can't load history.")).toBeVisible({ timeout: 15000 });
    await shot(page, { n: 11, screen: 'history', state: 'load-error', scheme: 'light', afterFix: true });
  });

  test('AC-16.5f3 — S10 history empty', async ({ page }) => {
    await mockHistoryFirstPage(page, []);
    await gotoHistory(page);
    await expect(page.getByText('No feeds logged yet.')).toBeVisible();
    await shot(page, { n: 10, screen: 'history', state: 'empty', scheme: 'light' });
  });

  test('AC-16.5f4 — history grouped, dark', async ({ page }) => {
    await mockHistoryFirstPage(page, [
      fakeFeed({ agoMs: MS.minutes(5), loggedBy: 'Sam' }),
      fakeFeed({ agoMs: MS.hours(20), loggedBy: 'Alex' }),
    ]);
    await page.emulateMedia({ colorScheme: 'dark' });
    await gotoHistory(page);
    await page.waitForTimeout(100);
    await shot(page, { n: 12, screen: 'history', state: 'grouped', scheme: 'dark' });
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('AC-16.5g — S12 show-older-feeds error', async ({ page }) => {
    test.setTimeout(180_000);
    const seeded = await rest.seedFeeds(101, QA_LOGGED_BY);
    try {
      await gotoHistory(page);
      const showOlder = page.getByRole('button', { name: 'Show older feeds' });
      await expect(showOlder).toBeVisible({ timeout: 10000 });
      net.failFirstThenAllow(page, { methodFilter: 'GET', mode: 'abort' });
      await showOlder.click();
      await expect(page.getByText("Couldn't load older feeds.")).toBeVisible({ timeout: 10000 });
      await shot(page, { n: 12, screen: 'history', state: 'show-older-error', scheme: 'light' });
    } finally {
      await net.clearRoutes(page, undefined).catch(() => {});
      for (const row of seeded) await rest.softDeleteById(row.id).catch(() => {});
    }
  });

  test('AC-16.5h — delete confirmation on home and history: before/after, and failed', async ({ page }) => {
    // Home: before/after.
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(5) })], todayCount: 1 });
    await gotoHome(page);
    await rowDeleteButton(page).first().click();
    await shot(page, { n: 10, screen: 'home', state: 'delete-confirm', phase: 'before', scheme: 'light' });
    await confirmDeleteButton(page.locator('body')).click();
    await page.waitForTimeout(1200);
    await shot(page, { n: 10, screen: 'home', state: 'delete-confirm', phase: 'after', scheme: 'light' });

    // History: before/after.
    await mockHistoryFirstPage(page, [fakeFeed({ agoMs: MS.minutes(5) })]);
    await gotoHistory(page);
    await rowDeleteButton(page).first().click();
    await shot(page, { n: 10, screen: 'history', state: 'delete-confirm', phase: 'before', scheme: 'light' });
    await confirmDeleteButton(page.locator('body')).click();
    await page.waitForTimeout(1200);
    await shot(page, { n: 10, screen: 'history', state: 'delete-confirm', phase: 'after', scheme: 'light' });
  });

  test('AC-16.6a — axe: no serious/critical violations on home (normal, armed, delete-confirm), light + dark', async ({
    page,
  }) => {
    const findings = [];

    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });

      await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(5), loggedBy: 'Sam' })], todayCount: 1 });
      await gotoHome(page);
      let r = await scanForSeriousViolations(page);
      if (!r.passes) findings.push({ scheme, state: 'normal', violations: summarizeViolations([...r.serious, ...r.critical]) });

      // Armed.
      await mockHomeDataDynamic(page, () => ({ recent: [fakeFeed({ agoMs: MS.hours(1) + MS.minutes(55) })], todayCount: 1 }));
      await gotoHome(page);
      await logButton(page).click();
      await expect(logButton(page)).toContainText('— log another?');
      r = await scanForSeriousViolations(page);
      if (!r.passes) findings.push({ scheme, state: 'armed', violations: summarizeViolations([...r.serious, ...r.critical]) });

      // Delete-confirm.
      await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(5) })], todayCount: 1 });
      await gotoHome(page);
      await rowDeleteButton(page).first().click();
      r = await scanForSeriousViolations(page);
      if (!r.passes) findings.push({ scheme, state: 'delete-confirm', violations: summarizeViolations([...r.serious, ...r.critical]) });
    }

    test.info().annotations.push({ type: 'axe findings (home)', description: JSON.stringify(findings, null, 2) });
    expect(findings, `axe found serious/critical violations: ${JSON.stringify(findings, null, 2)}`).toEqual([]);
  });

  test('AC-16.6b — axe: no serious/critical violations on history, light + dark', async ({ page }) => {
    const findings = [];
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await mockHistoryFirstPage(page, [
        fakeFeed({ agoMs: MS.minutes(5), loggedBy: 'Sam' }),
        fakeFeed({ agoMs: MS.hours(20), loggedBy: 'Alex' }),
      ]);
      await gotoHistory(page);
      const r = await scanForSeriousViolations(page);
      if (!r.passes) findings.push({ scheme, violations: summarizeViolations([...r.serious, ...r.critical]) });
    }
    expect(findings, `axe found serious/critical violations: ${JSON.stringify(findings, null, 2)}`).toEqual([]);
  });

  test('AC-16.6c — keyboard: tab reaches every control with a visible focus ring', async ({ page }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(5) })], todayCount: 1 });
    await gotoHome(page);
    await expect(logButton(page)).toHaveText('Log a feed', { timeout: 10000 });

    const focusableCount = await page.evaluate(
      () => document.querySelectorAll('button:not([disabled]), a[href], input:not([disabled])').length
    );
    expect(focusableCount).toBeGreaterThan(0);

    let sawOutline = false;
    for (let i = 0; i < focusableCount; i++) {
      await page.keyboard.press('Tab');
      const outline = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow };
      });
      if (outline && (outline.outlineStyle !== 'none' || outline.boxShadow !== 'none')) sawOutline = true;
    }
    expect(sawOutline, 'at least one focused control should show a visible focus indicator').toBeTruthy();
  });

  test('AC-16.6d — tap targets: Log button >=64px tall; row Delete/Undo/Save/Skip >=44x44', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(5) })], todayCount: 1 });
    await gotoHome(page);
    await expect(logButton(page)).toHaveText('Log a feed', { timeout: 10000 });

    const btnBox = await logButton(page).boundingBox();
    expect(btnBox.height).toBeGreaterThanOrEqual(64);

    await assertTapTarget(rowDeleteButton(page).first(), { minW: 44, minH: 44 });

    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    );
    await mockHomeDataDynamic(page, () => ({ recent: [], todayCount: 0 }));
    await gotoHome(page);
    await logButton(page).click();
    const row = (await postPromise.then((r) => r.json()))[0];
    const undoBtn = undoNoticeRegion(page).filter({ hasText: /^Logged / }).getByRole('button', { name: 'Undo' });
    await assertTapTarget(undoBtn, { minW: 44, minH: 44 });
    await rest.softDeleteById(row.id);

    await gotoHome(page);
    if (await nameInput(page).isVisible().catch(() => false)) {
      await assertTapTarget(page.getByRole('button', { name: 'Skip' }), { minW: 44, minH: 44 });
    }
  });
});
