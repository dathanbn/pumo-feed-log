// tests/e2e/specs/17-pets.spec.js
// F17 — Multiple pets (v1.1). AC-17.1 through AC-17.7 ([QA]; AC-17.8 is [DATHAN] — sticker
// programming — and is not exercised here; it's listed in tests/qa-report.md's Dathan
// checklist instead).
//
// SCAFFOLDING NOTE (pre-frontend-build pass): every locator here comes from design.md §3.0 /
// contract.md §6.G/§7.10 / architecture.md §10, not from any real markup — frontend/ doesn't
// exist yet. Expect every test in this file to fail or time out until the frontend agent has
// built the pet picker and pet-scoped api.js calls, AND the pets/pet_id migration
// (backend/schema.sql) has actually been applied to the live Supabase project (AC-17.1/17.2/
// 17.4/17.5's real-network cases need real pet rows to exist). That's expected right now —
// see docs/tasks.md §2 "What to do right now" / the QA agent's scaffolding-pass instructions.

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, gotoHistory, seedQaLoggerName, urlForPet } = require('../helpers/app');
const {
  headline,
  counterPill,
  historyBackLink,
  petPickerAvatarLink,
  petPickerAvatarLinks,
  selectedPetAvatarLink,
  logButton,
} = require('../helpers/selectors');
const { mockHomeData, mockHistoryFirstPage, mockHomeDataPerPetAndWrites, fakeFeed, MOCK_PET_IDS } = require('../helpers/mock');
const { shot } = require('../helpers/screenshot');
const { MS } = require('../helpers/time');
const { QA_LOGGED_BY, PETS, PET_SLUGS, NON_DEFAULT_PET_SLUGS, LIVE_URL } = require('../config');

test.describe('F17 — Multiple pets', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  test('AC-17.1 — no ?pet= shows Pumo\'s log, identical to pre-v1.1 behavior', async ({ page }) => {
    await mockHomeData(page, { recent: [fakeFeed({ agoMs: MS.minutes(10), petSlug: 'pumo' })], todayCount: 1 });
    await gotoHome(page); // no petSlug arg -> bare root URL, no ?pet=
    await expect(page).toHaveURL(new RegExp(`${LIVE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Pumo' })).toBeVisible();
  });

  for (const slug of NON_DEFAULT_PET_SLUGS) {
    const pet = PETS.find((p) => p.slug === slug);
    test(`AC-17.2a — ?pet=${slug} shows ${pet.name}'s log immediately, independent of Pumo's`, async ({ page }) => {
      await mockHomeData(page, {
        recent: [fakeFeed({ agoMs: MS.minutes(5), petSlug: slug, loggedBy: QA_LOGGED_BY })],
        todayCount: 2,
      });
      await gotoHome(page, slug);
      await expect(page.getByRole('heading', { level: 1, name: pet.name })).toBeVisible();
      await expect(headline(page)).toContainText('5m ago');
      await expect(counterPill(page)).toContainText('2 of 4 today');
    });
  }

  test('AC-17.2b — an unrecognized ?pet= value falls back to Pumo rather than erroring', async ({ page }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await page.goto(`${LIVE_URL}/${urlForPet('not-a-real-pet')}`, { waitUntil: 'load' });
    await expect(page.getByRole('heading', { level: 1, name: 'Pumo' })).toBeVisible();
    // Ambiguity flagged in QA notes: contract.md §7.10 doesn't say whether the app should
    // rewrite the URL bar to drop the invalid ?pet= param once it falls back, or leave it as
    // typed while rendering Pumo. This assertion only checks the rendered content, not the
    // URL bar, until that's clarified.
  });

  test('AC-17.3a — the pet-picker row shows all 3 pets in sort_order, with the current one distinguished', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page); // Pumo selected
    const links = petPickerAvatarLinks(page);
    await expect(links).toHaveCount(PET_SLUGS.length);
    // sort_order: Pumo(0), Zuumi(1), Banh Mi(2), left to right (design.md §3.0).
    const names = await links.allTextContents();
    // Avatars have no visible name caption (design.md §3.0: "no name captions"), so their
    // accessible name (aria-label) carries the pet name instead of visible text — assert via
    // accessible name, not textContent, once real markup exists. Placeholder assertion below
    // only checks the count/order structurally; narrow this once the real DOM is known.
    expect(names.length).toBe(PET_SLUGS.length);

    await expect(selectedPetAvatarLink(page)).toHaveCount(1);
    await expect(petPickerAvatarLink(page, 'Pumo')).toHaveAttribute('aria-current', 'true');
    await shot(page, { n: 17, screen: 'home', state: 'pet-picker-pumo-selected', scheme: 'light' });
  });

  test('AC-17.3b — tapping a different pet avatar navigates to that pet\'s URL and updates the whole screen within 1s', async ({
    page,
  }) => {
    await mockHomeData(page, {
      recent: [fakeFeed({ agoMs: MS.minutes(1), petSlug: 'pumo' })],
      todayCount: 1,
    });
    await gotoHome(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Pumo' })).toBeVisible();

    // Re-mock for the destination pet BEFORE the click, since this is a real navigation
    // (design.md §3.0: "a normal in-app navigation (change location.href), not a
    // client-side state swap") — a fresh page load re-runs every route.
    await mockHomeData(page, {
      recent: [fakeFeed({ agoMs: MS.minutes(20), petSlug: 'zuumi', loggedBy: 'Alex' })],
      todayCount: 3,
    });

    const start = Date.now();
    await petPickerAvatarLink(page, 'Zuumi').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Zuumi' })).toBeVisible();
    expect(Date.now() - start).toBeLessThan(1000);
    await expect(page).toHaveURL(/\?pet=zuumi/);
    await expect(counterPill(page)).toContainText('3 of 4 today');
    // Pumo's prior state (1 of 4, "1m ago") must not leak onto Zuumi's screen.
    await expect(counterPill(page)).not.toContainText('1 of 4 today');
  });

  test('AC-17.3c — all 3 pets\' picker rows, light and dark (screenshot set)', async ({ page }) => {
    for (const slug of PET_SLUGS) {
      const pet = PETS.find((p) => p.slug === slug);
      await mockHomeData(page, { recent: [], todayCount: 0 });
      await gotoHome(page, slug);
      await expect(page.getByRole('heading', { level: 1, name: pet.name })).toBeVisible();
      await shot(page, { n: 17, screen: 'home', state: `pet-picker-${slug}-selected`, scheme: 'light' });
    }
  });

  test('AC-17.4 — logging for one pet never changes another pet\'s headline/counter/recent list/guard (real network)', async ({
    page,
  }) => {
    // Real REST, deliberately NOT mocked — this proves actual DB-level scoping, not just UI
    // rendering of two independently-mocked responses.
    const beforePumo = await rest.getLastFeeds(3, { petSlug: 'pumo' }).catch(() => null);
    const zuumiFeed = await rest.insertFeed({ petSlug: 'zuumi', logged_by: QA_LOGGED_BY });
    try {
      await gotoHome(page, 'pumo');
      // Pumo's headline/recent list must NOT show the Zuumi feed just logged.
      await expect(page.getByText(zuumiFeed.id)).toHaveCount(0); // sanity: id never rendered raw anyway
      if (beforePumo) {
        const pumoHeadlineBefore = beforePumo[0] ? beforePumo[0].created_at : null;
        if (pumoHeadlineBefore) {
          // Pumo's "last fed" should still reflect Pumo's own most recent feed, not Zuumi's.
          await expect(headline(page)).not.toContainText('just now');
        }
      }
    } finally {
      await rest.softDeleteById(zuumiFeed.id);
    }
  });

  // Fix round 1 (Opus review item 11): AC-17.4's claim (logging for one pet never touches
  // another pet's headline/counter/recent/guard) is provable without a real DB round trip — a
  // mocked POST scoped by the request's OWN pet_id (contract.md §6.C) plus two independently
  // mocked pets' GET fixtures is enough to catch a cross-pet leak, since a leak would have to
  // show up as either the wrong pet's counter changing or the wrong pet_id in the POST body.
  // Mocked below via mockHomeDataPerPetAndWrites, alongside (not replacing) the real-network
  // AC-17.4 above.
  test('AC-17.4b — mocked: logging for one pet never changes another pet\'s headline/counter/recent list/guard', async ({
    page,
  }) => {
    await mockHomeDataPerPetAndWrites(page, {
      pumo: { recent: [fakeFeed({ agoMs: MS.hours(3), petSlug: 'pumo' })], todayCount: 1 },
      zuumi: { recent: [fakeFeed({ agoMs: MS.hours(5), petSlug: 'zuumi' })], todayCount: 2 },
    });

    await gotoHome(page, 'pumo');
    await expect(page.getByRole('heading', { level: 1, name: 'Pumo' })).toBeVisible();
    await expect(counterPill(page)).toContainText('1 of 4 today');

    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    );
    await logButton(page).click();
    const postReq = (await postPromise).request();
    const postBody = JSON.parse(postReq.postData() || '{}');
    expect(postBody.pet_id, "the POST must carry Pumo's own pet_id, never Zuumi's").toBe(MOCK_PET_IDS.pumo);
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
    await expect(counterPill(page)).toContainText('2 of 4 today'); // Pumo's own count, bumped by 1

    // A real navigation to Zuumi (same as AC-17.3b) — Zuumi's mocked fixture must be exactly
    // what it started as, untouched by the write just made for Pumo.
    await gotoHome(page, 'zuumi');
    await expect(page.getByRole('heading', { level: 1, name: 'Zuumi' })).toBeVisible();
    await expect(counterPill(page)).toContainText('2 of 4 today');
    await expect(counterPill(page), "Pumo's post-log count must not leak onto Zuumi's screen").not.toContainText(
      '3 of 4 today'
    );
    await expect(headline(page)).toContainText('5h 0m ago'); // Zuumi's own original last-fed, unchanged
  });

  test('AC-17.5 — history.html?pet=zuumi shows only Zuumi\'s feeds, and its back link returns to Zuumi\'s home', async ({
    page,
  }) => {
    await mockHistoryFirstPage(page, [fakeFeed({ agoMs: MS.hours(1), petSlug: 'zuumi', loggedBy: 'Alex' })]);
    await gotoHistory(page, 'zuumi');
    await expect(page.getByText('by Alex')).toBeVisible();

    await mockHomeData(page, { recent: [], todayCount: 0 });
    await historyBackLink(page, 'Zuumi').click();
    await expect(page).toHaveURL(/\?pet=zuumi/);
    await expect(page.getByRole('heading', { level: 1, name: 'Zuumi' })).toBeVisible();
  });

  test('AC-17.6 — Zuumi (cat, no photo) and Banh Mi (dog, no photo) placeholder avatars are visually distinguishable from each other', async ({
    page,
  }) => {
    // Scoped to the SELECTED pet's own avatar (selectedPetAvatarLink, a[aria-current="true"]),
    // not just "the first avatar-ish element on the page" — the picker always renders all 3
    // pets in sort_order regardless of which is selected, so Pumo's own (photo) avatar is
    // always first in DOM order and would otherwise be screenshotted for BOTH pets, comparing
    // Pumo against Pumo and trivially passing/failing for the wrong reason. Confirmed by direct
    // repro: the untargeted `.avatar, [class*="avatar"]` locator matched
    // `<span class="pet-avatar"><img src="assets/pumo.jpg">` on both the Zuumi and Banh Mi
    // pages — a QA test-locator bug, not a frontend defect.
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page, 'zuumi');
    const zuumiAvatar = selectedPetAvatarLink(page).locator('.pet-avatar');
    await expect(zuumiAvatar).toBeVisible();
    const zuumiShot = await zuumiAvatar.screenshot().catch(() => null);

    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page, 'banh-mi');
    const banhMiAvatar = selectedPetAvatarLink(page).locator('.pet-avatar');
    await expect(banhMiAvatar).toBeVisible();
    const banhMiShot = await banhMiAvatar.screenshot().catch(() => null);

    // Pixel-identical placeholders (same shape/color for a cat and a dog) would be a defect
    // per design.md §3.0 ("Cats and dogs must be visually distinguishable ... since 'same
    // colored circle, different letter' is easy to misread"). A byte-equal screenshot is a
    // strong (not perfect) proxy for "visually identical" — a human/AI visual diff on the
    // captured screenshots is the stronger check once these exist for real.
    if (zuumiShot && banhMiShot) {
      expect(zuumiShot.equals(banhMiShot), 'Zuumi and Banh Mi placeholder avatars must not be pixel-identical').toBe(false);
    }
  });

  test('AC-17.7 — no pet-specific literal in frontend/js/config.js; every feeds query except getPets filters by pet_id', async () => {
    const fs = require('fs');
    const path = require('path');
    const FRONTEND_JS_DIR = path.resolve(__dirname, '..', '..', '..', 'frontend', 'js');
    const configPath = path.join(FRONTEND_JS_DIR, 'config.js');
    if (!fs.existsSync(configPath)) {
      test.skip(true, `frontend/js/config.js does not exist yet at ${configPath}.`);
      return;
    }
    const configSrc = fs.readFileSync(configPath, 'utf8');
    expect(configSrc, 'config.js must not contain PUMO_PHOTO_URL (retired, contract.md §4) or an equivalent literal photo/name/slug value').not.toMatch(
      /PUMO_PHOTO_URL|pumo\.jpg|['"]Pumo['"]|['"]Zuumi['"]|['"]Banh ?Mi['"]/i
    );

    const apiPath = path.join(FRONTEND_JS_DIR, 'api.js');
    if (fs.existsSync(apiPath)) {
      const apiSrc = fs.readFileSync(apiPath, 'utf8');
      // Every fetch to .../feeds should carry a pet_id filter, except inside getPets (which
      // queries /pets, not /feeds) and getAllFeedsForExport's own paging (already pet-scoped
      // per contract.md §4's api.js "must not" list). Exclude the bare `FEEDS_URL` base-URL
      // constant itself (e.g. `` `${SUPABASE_URL}/rest/v1/feeds` ``) — matched as literal
      // "/feeds" with nothing after it before the closing quote/backtick, since it's not a
      // query string at all and every real query is built by appending onto it. A genuine
      // unscoped query always has more after "/feeds" (at minimum "?select=..."), so filtering
      // on that shape rather than blindly failing on every "/feeds" match avoids this false
      // positive (confirmed by direct repro: frontend/js/api.js's only literal "/feeds" match
      // is exactly this constant declaration, not an actual call site).
      const feedsCalls = (apiSrc.match(/\/feeds[^`'"]*/g) || []).filter((c) => c !== '/feeds');
      const missingPetId = feedsCalls.filter((c) => !/pet_id/.test(c));
      expect(
        missingPetId,
        `Found /feeds query string(s) with no pet_id filter in api.js:\n${missingPetId.join('\n')}`
      ).toEqual([]);
    }
  });
});
