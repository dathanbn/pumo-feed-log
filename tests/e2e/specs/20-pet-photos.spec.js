// tests/e2e/specs/20-pet-photos.spec.js
// F20 — Real photos for Zuumi and Banh Mi (v1.2). AC-20.1, AC-20.2.
//
// AC-20.1: Zuumi's and Banh Mi's pet-picker avatars show their real photos, not the
// placeholder shape — pets.photo_url is set for all 3 pets now (contract.md §1/§2's v1.2
// backfill), which config.js's PETS fixture mirrors (see that file's own v1.2 note).
// AC-20.2: this is a pure data change — no new frontend logic. getPets() already returns
// whatever photo_url the database has, and F17 already built the "photo vs. placeholder"
// branch (frontend/js/ui.js buildPetAvatar). This spec proves the EXISTING code renders a
// real <img src="assets/{slug}.jpg"> for both, and that the placeholder path is no longer
// reachable for any of today's 3 real pets via the default (unmodified) fixture — it does
// not exercise any new branch, because there isn't one.

'use strict';

const { test, expect } = require('../helpers/fixtures');
const { gotoHome, seedQaLoggerName } = require('../helpers/app');
const { selectedPetAvatarLink, petPickerAvatarLinks } = require('../helpers/selectors');
const { mockHomeData, mockPetRows } = require('../helpers/mock');
const { shot } = require('../helpers/screenshot');
const { QA_LOGGED_BY, PETS } = require('../config');

test.describe('F20 — Real photos for Zuumi and Banh Mi', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  for (const slug of ['zuumi', 'banh-mi']) {
    const pet = PETS.find((p) => p.slug === slug);
    test(`AC-20.1a — ${pet.name}'s SELECTED-pet avatar renders a real <img src="${pet.photo_url}">, not the SVG placeholder`, async ({
      page,
    }) => {
      // Default (unmodified) mockPetRows()/mockHomeData fixture — this is what now mirrors the
      // real, live database (contract.md §2's v1.2 backfill; config.js's own v1.2 note), unlike
      // specs/17-pets.spec.js's AC-17.6, which deliberately overrides photo_url back to null to
      // keep exercising the (now-hypothetical-only) placeholder code path.
      await mockHomeData(page, { recent: [], todayCount: 0 });
      await gotoHome(page, slug);
      await expect(page.getByRole('heading', { level: 1, name: pet.name })).toBeVisible();

      const avatarWrap = selectedPetAvatarLink(page).locator('.pet-avatar');
      await expect(avatarWrap).toBeVisible();
      const img = avatarWrap.locator('.pet-avatar__img');
      await expect(img, `${pet.name}'s avatar should render a real <img>, not the placeholder SVG`).toHaveCount(1);
      await expect(avatarWrap.locator('svg')).toHaveCount(0); // placeholder branch not taken
      await expect(img).toHaveAttribute('src', new RegExp(`${pet.photo_url.replace('.', '\\.')}$`));
      // Decorative (design.md §3.0/AC-16.1 pattern): the <img> carries alt="" and the wrapper
      // is aria-hidden, since the picker link's own aria-label already names the pet.
      await expect(img).toHaveAttribute('alt', '');
      await expect(avatarWrap).toHaveAttribute('aria-hidden', 'true');
    });
  }

  test('AC-20.1b — on the HOME picker row, Zuumi\'s and Banh Mi\'s (non-selected) avatars also show real photos, not placeholders', async ({
    page,
  }) => {
    // Same check, but for the picker's OTHER (non-selected) avatars while Pumo is selected —
    // AC-20.1 names "the pet-picker avatars" generally, not only the selected one.
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page); // Pumo selected; Zuumi/Banh Mi render as the picker's other avatars
    const links = petPickerAvatarLinks(page);
    await expect(links).toHaveCount(PETS.length);

    for (const pet of PETS.filter((p) => p.slug !== 'pumo')) {
      const link = page.getByRole('link', { name: pet.name, exact: true });
      const avatar = link.locator('.pet-avatar');
      await expect(avatar.locator('img')).toHaveCount(1);
      await expect(avatar.locator('svg')).toHaveCount(0);
      await expect(avatar.locator('img')).toHaveAttribute('src', new RegExp(`${pet.photo_url.replace('.', '\\.')}$`));
    }
  });

  test('AC-20.1c — screenshot: pet picker on home showing Zuumi\'s and Banh Mi\'s real photos (no more placeholder)', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page); // Pumo selected; picker row shows all 3, including the two real photos
    await expect(page.getByRole('heading', { level: 1, name: 'Pumo' })).toBeVisible();
    const scheme = await page.evaluate(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    await shot(page, { n: 20, screen: 'home', state: 'pet-picker-real-photos', scheme });
  });

  test('AC-20.1d — screenshots: Zuumi and Banh Mi each selected, showing their own real photo as the large ringed avatar', async ({
    page,
  }) => {
    for (const slug of ['zuumi', 'banh-mi']) {
      await mockHomeData(page, { recent: [], todayCount: 0 });
      await gotoHome(page, slug);
      const pet = PETS.find((p) => p.slug === slug);
      await expect(page.getByRole('heading', { level: 1, name: pet.name })).toBeVisible();
      const scheme = await page.evaluate(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
      await shot(page, { n: 20, screen: 'home', state: `pet-picker-${slug}-real-photo-selected`, scheme });
    }
  });

  test('AC-20.2 — no frontend code change was needed: getPets() (contract.md §6.G) passes through whatever photo_url the DB has, verbatim', async ({
    page,
  }) => {
    // Prove the SAME buildPetAvatar/getPets code path handles an arbitrary photo_url value
    // with no special-casing for these two slugs specifically (i.e. this is a data-only
    // change, not new per-pet logic) — feed it a made-up photo_url for Zuumi via
    // mockPetRows' overrides and confirm the picker renders exactly that <img src>, unchanged.
    const customPets = mockPetRows([{}, { photo_url: 'assets/custom-test-photo.jpg' }, {}]);
    await mockHomeData(page, { recent: [], todayCount: 0, pets: customPets });
    await gotoHome(page, 'zuumi');
    const avatarWrap = selectedPetAvatarLink(page).locator('.pet-avatar');
    await expect(avatarWrap.locator('img')).toHaveAttribute('src', /custom-test-photo\.jpg$/);
  });
});
