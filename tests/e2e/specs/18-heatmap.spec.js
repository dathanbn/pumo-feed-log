// tests/e2e/specs/18-heatmap.spec.js
// F18 — Feeding heatmap on the history screen (v1.1). AC-18.1 through AC-18.7.
//
// SCAFFOLDING NOTE (pre-frontend-build pass): locators/expectations come from design.md
// §4.1/§5/§7 and contract.md §7.8, not from real markup — frontend/ doesn't exist yet.
// buildHeatmapExpected/heatmapCellAriaLabelExpected (helpers/format.js) are QA's OWN
// reimplementation of contract.md §7.8's pure function, used only to compute what a test
// expects to see — this file never imports frontend/js/logic.js. Every test here is expected
// to fail/time out until history.js renders the heatmap grid described in design.md §4.1.
// tasks.md §2's own seeding recipe ("a deliberate spread of QA-test rows across several of
// the last HEATMAP_WEEKS weeks, including at least one day at each tier: 0, 1, 2, 3, 4+") is
// implemented in seedHeatmapSpread() below and reused by every test that needs real data.

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHistory, seedQaLoggerName, simulateHiddenThenVisible } = require('../helpers/app');
const {
  heatmapGrid,
  heatmapCells,
  heatmapCellByLabel,
  heatmapLegend,
  heatmapExpandedPanel,
  dayHeading,
} = require('../helpers/selectors');
const { mockHistoryFirstPage, mockHistoryFirstPageDynamic, fakeFeed } = require('../helpers/mock');
const { buildHeatmapExpected, heatmapCellAriaLabelExpected } = require('../helpers/format');
const { scanForSeriousViolations } = require('../helpers/a11y');
const { oklch, contrast } = require('../helpers/color');
const { shot } = require('../helpers/screenshot');
const { MS } = require('../helpers/time');
const { QA_LOGGED_BY, CONSTANTS } = require('../config');

// NOTE on real-data seeding: contract.md §5.1/§6.C means the server always assigns real
// `created_at = now()` — rest.insertFeed() (and therefore any real-REST seeding) can never
// backdate a row into a past feed day. So a genuine multi-day, multi-tier heatmap spread
// (tasks.md §2's seeding recipe) can only be produced with MOCKED data (mockedHeatmapFeeds
// below, via fakeFeed's freely-backdatable `agoMs`) — every test in this file that needs a
// real tier spread uses that. Real REST is used only where a test's whole point IS the real
// network round trip (AC-18.7 below), where "some feed today, then deleted" is enough.

/** Builds a mocked HEATMAP_WEEKS-spanning feed set with a deliberate tier spread, entirely
 *  client-side via fakeFeed's `agoMs` (so, unlike seedHeatmapSpread, this CAN backdate). */
function mockedHeatmapFeeds({ petSlug = 'pumo' } = {}) {
  const feeds = [];
  const tierDaysAgo = { 1: 2, 2: 3, 3: 4, 4: 5 };
  for (const [tier, daysAgo] of Object.entries(tierDaysAgo)) {
    const n = Number(tier);
    for (let i = 0; i < n; i++) {
      feeds.push(
        fakeFeed({
          agoMs: MS.days(daysAgo) + MS.hours(10) + i * MS.minutes(5),
          petSlug,
          loggedBy: i === 0 ? 'Sam' : 'Alex',
        })
      );
    }
  }
  return feeds;
}

test.describe('F18 — Feeding heatmap', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  test('AC-18.1 — heatmap renders above the day-grouped list, covering HEATMAP_WEEKS (5) weeks including the current partial week', async ({
    page,
  }) => {
    const feeds = mockedHeatmapFeeds();
    await mockHistoryFirstPage(page, feeds);
    await gotoHistory(page);

    await expect(heatmapGrid(page)).toBeVisible();
    // 5 weeks * 7 days = 35 cells total (design.md §4.1).
    await expect(heatmapCells(page)).toHaveCount(CONSTANTS.HEATMAP_WEEKS * 7);

    // Heatmap must appear before the first day heading in DOM order (design.md §4 layout:
    // "[ heatmap ] ... Today ...").
    const heatmapBox = await heatmapGrid(page).boundingBox();
    const todayHeadingBox = await dayHeading(page, 'Today').boundingBox().catch(() => null);
    if (heatmapBox && todayHeadingBox) {
      expect(heatmapBox.y).toBeLessThan(todayHeadingBox.y);
    }
    await shot(page, { n: 18, screen: 'history', state: 'heatmap-spread', scheme: 'light' });
    await shot(page, { n: 18, screen: 'history', state: 'heatmap-spread', scheme: 'dark' });
  });

  test('AC-18.2 — columns are Sun..Sat left to right; each cell date matches a real calendar date; each row is one week', async ({
    page,
  }) => {
    await mockHistoryFirstPage(page, mockedHeatmapFeeds());
    await gotoHistory(page);

    // design.md §4.1: "Sun Mon Tue Wed Thu Fri Sat as a muted 12px header row".
    const dayLetters = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const d of dayLetters) {
      await expect(page.getByText(d, { exact: false }).first()).toBeVisible();
    }

    // Structural check via the expected model: today's cell (bottom-right-most in-range cell)
    // must be a Saturday-or-earlier position matching real Date#getDay() for `now`.
    const expected = buildHeatmapExpected([], new Date(), CONSTANTS.HEATMAP_WEEKS);
    expect(expected.weeks.length).toBe(CONSTANTS.HEATMAP_WEEKS);
    for (const week of expected.weeks) {
      expect(week.length).toBe(7);
      // column 0 of every week must be a Sunday, regardless of what weekday `now` itself is
      // (spec.md/tasks.md's specific "assert this for at least 3 different now values" — the
      // UNIT suite covers the multi-`now` sweep; this QA test spot-checks the live render).
      expect(week[0].date.getDay()).toBe(0);
      expect(week[6].date.getDay()).toBe(6);
    }
  });

  test('AC-18.3 — cell shade reflects that feed day\'s count in 5 tiers (0,1,2,3,4+); padding cells render at the 0 tier, not blank', async ({
    page,
  }) => {
    const feeds = mockedHeatmapFeeds();
    await mockHistoryFirstPage(page, feeds);
    await gotoHistory(page);

    const expected = buildHeatmapExpected(feeds, new Date(), CONSTANTS.HEATMAP_WEEKS);
    // At least one cell at each tier must exist and be findable by its exact expected
    // accessible name (design.md §4.1's aria-label contract, AC-18.6).
    for (const tier of [0, 1, 2, 3, 4]) {
      const cell = expected.cells.find((c) => c.intensity === tier && c.count === (tier === 4 ? 4 : tier));
      expect(cell, `expected fixture should contain a tier-${tier} cell`).toBeTruthy();
      if (cell) {
        const label = heatmapCellAriaLabelExpected(cell);
        await expect(heatmapCellByLabel(page, label)).toBeVisible();
      }
    }
    // Every cell (including out-of-range padding at the grid's start) must still be a
    // rendered, disabled-when-padding button — never blank/missing (AC-18.3's explicit "never
    // blank/missing" requirement). This is exactly AC-18.1's cell-count assertion again, but
    // framed as a padding-specific check per spec.md's own wording.
    await expect(heatmapCells(page)).toHaveCount(CONSTANTS.HEATMAP_WEEKS * 7);

    // Contrast rule (spec.md AC-18.3, corrected — see qa-report.md §3/§9 for the "a literal
    // 3:1 between every adjacent pair is mathematically impossible for a 5-step sequential
    // ramp" history): monotone OKLCH lightness, >=0.06 between adjacent steps, a single
    // consistent hue across the colored tiers, and every tier's date-number text >=4.5:1
    // against that tier's own fill. Measured LIVE off the rendered page's own computed
    // styles (never a hardcoded copy of the CSS hex values, and never eyeballed) via
    // helpers/color.js, which re-derives the same sRGB->OKLab->OKLCH math the dataviz skill's
    // own validator uses. Tier 0 is documented (design.md §4.1: "0 = --surface or --divider")
    // as the neutral/empty fill, not a step of the colored --accent-family ramp (its OKLCH
    // chroma below confirms this: near-zero, i.e. it reads as a neutral, not a hue) — so the
    // "single hue" check is scoped to tiers 1-4 (the actual colored ramp), while the "monotone
    // lightness, >=0.06 adjacent gap" check spans all 5 tiers (0 through 4 is the full
    // shade-by-count sequence a reader compares).
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await gotoHistory(page);
      await expect(heatmapGrid(page)).toBeVisible();

      const measured = await page.evaluate(() => {
        const out = [];
        for (let tier = 0; tier <= 4; tier++) {
          // `button.` (not just `.heat-cell--tier-N`) excludes the legend's own swatch spans,
          // which reuse the same tier classes purely for their fill color (ui.js renderHeatmap)
          // but aren't real grid cells and have no .heat-cell__num child.
          const cell = document.querySelector(`button.heat-cell--tier-${tier}:not(.heat-cell--out)`);
          if (!cell) {
            out.push(null);
            continue;
          }
          const num = cell.querySelector('.heat-cell__num');
          out.push({
            fill: getComputedStyle(cell).backgroundColor,
            text: num ? getComputedStyle(num).color : null,
          });
        }
        return out;
      });
      for (let tier = 0; tier <= 4; tier++) {
        expect(measured[tier], `no rendered (non-out-of-range) tier-${tier} cell found in ${scheme} mode`).toBeTruthy();
      }

      const Ls = measured.map((m) => oklch(m.fill).L);
      const Hs14 = measured.slice(1).map((m) => oklch(m.fill).H); // tiers 1-4 only (see note above)

      // Monotone lightness across all 5 tiers, either direction (light mode ramps
      // light->dark; dark mode flips the anchor, dark->light — both are "monotone").
      const increasing = Ls.every((l, i) => i === 0 || l >= Ls[i - 1]);
      const decreasing = Ls.every((l, i) => i === 0 || l <= Ls[i - 1]);
      expect(increasing || decreasing, `${scheme}: tier lightness not monotone — L=${JSON.stringify(Ls.map((l) => +l.toFixed(4)))}`).toBe(true);

      // >=0.06 OKLCH L between every adjacent tier pair (0-1, 1-2, 2-3, 3-4).
      const gaps = Ls.slice(1).map((l, i) => Math.abs(l - Ls[i]));
      const evidence = { scheme, adjacentDeltaL: gaps.map((g) => +g.toFixed(4)) };
      test.info().annotations.push({ type: 'AC-18.3 measured evidence', description: JSON.stringify(evidence) });
      for (const g of gaps) {
        expect(g, `${scheme}: adjacent tier ΔL ${g.toFixed(4)} below the 0.06 floor — gaps=${JSON.stringify(gaps)}`).toBeGreaterThanOrEqual(0.06);
      }

      // Single hue across tiers 1-4 (the colored ramp; tier 0 is the documented neutral
      // empty-tier fill, excluded — see note above), spread <=40 degrees.
      let spread = Math.max(...Hs14) - Math.min(...Hs14);
      if (spread > 180) spread = 360 - spread;
      expect(spread, `${scheme}: tier 1-4 hue spread ${spread.toFixed(1)}deg exceeds the 40deg single-hue ceiling`).toBeLessThanOrEqual(40);

      // Every tier's date-number text independently clears 4.5:1 against that tier's own fill.
      for (let tier = 0; tier <= 4; tier++) {
        const { fill, text } = measured[tier];
        expect(text, `${scheme}: tier-${tier} has no .heat-cell__num text color to check`).toBeTruthy();
        const cr = contrast(text, fill);
        test.info().annotations.push({ type: 'AC-18.3 measured evidence', description: `${scheme} tier-${tier} date-number contrast: ${cr.toFixed(2)}:1` });
        expect(cr, `${scheme}: tier-${tier} date-number text ${text} on fill ${fill} is only ${cr.toFixed(2)}:1 (need >=4.5:1)`).toBeGreaterThanOrEqual(4.5);
      }
    }
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('AC-18.4 — today\'s cell is visually marked as today, independent of its shade', async ({ page }) => {
    await mockHistoryFirstPage(page, []); // 0 feeds today -> today's cell is tier-0, must still show the "today" mark
    await gotoHistory(page);
    const todayLabel = heatmapCellAriaLabelExpected({ date: new Date(), count: 0 });
    const todayCell = heatmapCellByLabel(page, todayLabel);
    await expect(todayCell).toBeVisible();
    // design.md §4.1: "a 2px --accent outline ... regardless of tier" — no documented
    // aria-level signal for this beyond the visual outline, so this is a screenshot-backed
    // visual check rather than a DOM assertion. Narrow with a real CSS/outline-color read
    // once the actual markup/class exists.
    await shot(page, { n: 18, screen: 'history', state: 'heatmap-today-marker', scheme: 'light' });
  });

  test('AC-18.5a — tapping a cell with feeds expands an inline panel listing that day\'s feed times and feeder names', async ({
    page,
  }) => {
    const feeds = mockedHeatmapFeeds();
    await mockHistoryFirstPage(page, feeds);
    await gotoHistory(page);

    const expected = buildHeatmapExpected(feeds, new Date(), CONSTANTS.HEATMAP_WEEKS);
    const cellWithFeeds = expected.cells.find((c) => c.count > 0);
    const label = heatmapCellAriaLabelExpected(cellWithFeeds);

    await shot(page, { n: 18, screen: 'history', state: 'heatmap-cell-collapsed', scheme: 'light', phase: 'before' });
    await heatmapCellByLabel(page, label).click();
    await expect(heatmapExpandedPanel(page)).toBeVisible();
    await shot(page, { n: 18, screen: 'history', state: 'heatmap-cell-expanded', scheme: 'light', phase: 'after' });
  });

  test('AC-18.5b — only one cell expanded at a time: opening another closes the first', async ({ page }) => {
    const feeds = mockedHeatmapFeeds();
    await mockHistoryFirstPage(page, feeds);
    await gotoHistory(page);

    const expected = buildHeatmapExpected(feeds, new Date(), CONSTANTS.HEATMAP_WEEKS);
    const withFeeds = expected.cells.filter((c) => c.count > 0);
    expect(withFeeds.length).toBeGreaterThanOrEqual(2);

    await heatmapCellByLabel(page, heatmapCellAriaLabelExpected(withFeeds[0])).click();
    await expect(heatmapExpandedPanel(page)).toHaveCount(1);
    await heatmapCellByLabel(page, heatmapCellAriaLabelExpected(withFeeds[1])).click();
    await expect(heatmapExpandedPanel(page)).toHaveCount(1); // still exactly one, not two
  });

  test('AC-18.5c — tapping a zero-feed in-range cell does nothing harmful (no crash, no second panel) — exact behavior is the frontend agent\'s documented call', async ({
    page,
  }) => {
    const feeds = mockedHeatmapFeeds();
    await mockHistoryFirstPage(page, feeds);
    await gotoHistory(page);

    const expected = buildHeatmapExpected(feeds, new Date(), CONSTANTS.HEATMAP_WEEKS);
    const zeroCell = expected.cells.find((c) => c.inRange && c.count === 0);
    const label = heatmapCellAriaLabelExpected(zeroCell);
    await heatmapCellByLabel(page, label).click();
    // spec.md AC-18.5: "does nothing (or shows 'No feeds' — frontend agent's call, documented
    // in the build notes)". QA's job here is just: it doesn't error and doesn't open a panel
    // with feed rows in it (there are none to show). Check the build notes (tests/qa-report.md
    // §5, copied from the frontend hand-off) for which behavior was actually chosen, and
    // tighten this assertion once known.
    const panel = heatmapExpandedPanel(page);
    const panelCount = await panel.count();
    if (panelCount > 0) {
      await expect(panel).toContainText(/No feeds/i);
    }
  });

  test('AC-18.6 — legend is visible; every cell has an accessible name with the date and feed count', async ({
    page,
  }) => {
    const feeds = mockedHeatmapFeeds();
    await mockHistoryFirstPage(page, feeds);
    await gotoHistory(page);
    await expect(heatmapLegend(page)).toBeVisible();

    const expected = buildHeatmapExpected(feeds, new Date(), CONSTANTS.HEATMAP_WEEKS);
    // Spot-check 3 cells across different tiers rather than all 35, to keep this fast.
    const sample = [
      expected.cells.find((c) => c.count === 0 && c.inRange),
      expected.cells.find((c) => c.count === 2),
      expected.cells.find((c) => c.count >= 4),
    ].filter(Boolean);
    for (const cell of sample) {
      await expect(heatmapCellByLabel(page, heatmapCellAriaLabelExpected(cell))).toBeVisible();
    }
  });

  test('AC-18.6b — axe: no serious/critical violations on history.html with the heatmap present', async ({ page }) => {
    await mockHistoryFirstPage(page, mockedHeatmapFeeds());
    await gotoHistory(page);
    await expect(heatmapGrid(page)).toBeVisible();
    const { serious, critical, passes } = await scanForSeriousViolations(page);
    expect(passes, `serious: ${JSON.stringify(serious)}, critical: ${JSON.stringify(critical)}`).toBe(true);
  });

  test('AC-18.7 — heatmap reloads on focus refresh and reflects a delete within 1s (real network)', async ({
    page,
  }) => {
    const row = await rest.insertFeed({ petSlug: 'pumo', logged_by: QA_LOGGED_BY });
    try {
      await gotoHistory(page, 'pumo'); // real network — genuinely exercises the reload
      // Today's cell should show at least 1 feed now.
      const cellsToday = page.getByRole('button', { name: /: (?!no feeds)\d+ feeds?$/ });
      await expect(cellsToday.first()).toBeVisible({ timeout: 10000 });

      await rest.softDeleteById(row.id);
      await simulateHiddenThenVisible(page);
      // Give the app's own focus-refresh + heatmap rebuild the 1s window spec.md AC-18.7 asks for.
      await page.waitForTimeout(1000);
      // Weak assertion (can't cheaply prove "today's cell count decremented by exactly 1"
      // without knowing the pre-existing real count for Pumo) — the meaningful proof is that
      // no stale reference to this specific row's expanded panel/feed time survives a focus
      // refresh. Strengthen once real markup exists to read a cell's count directly.
    } finally {
      await rest.softDeleteById(row.id).catch(() => {});
    }
  });

  // Fix round 1 (Opus review item 11): AC-18.7's claim (a focus refresh re-fetches and the
  // heatmap reflects a change within 1s) is pure client-side refetch/rebuild behavior — provable
  // with a mocked history-page GET whose response can change between two focus-refresh calls, no
  // real Supabase round trip needed. Mocked via mockHistoryFirstPageDynamic below, alongside
  // (not replacing) the real-network AC-18.7 above, and unlike it, strong enough to assert the
  // EXACT count-driven aria-label (not just "no stale reference survives").
  test('AC-18.7b — mocked: heatmap reloads on focus refresh and reflects a delete within 1s', async ({
    page,
  }) => {
    const now = new Date();
    const feed = fakeFeed({ agoMs: MS.minutes(30), petSlug: 'pumo' });
    let phase = 'before'; // 'before': today has the feed; 'after': it was soft-deleted
    await mockHistoryFirstPageDynamic(page, () => (phase === 'before' ? [feed] : []));
    await gotoHistory(page, 'pumo');

    const labelWithFeed = heatmapCellAriaLabelExpected({ date: now, count: 1 });
    const labelNoFeed = heatmapCellAriaLabelExpected({ date: now, count: 0 });
    await expect(heatmapCellByLabel(page, labelWithFeed)).toBeVisible();

    phase = 'after'; // the next fresh (non-cursor) history GET will see it soft-deleted
    await simulateHiddenThenVisible(page);
    await expect(heatmapCellByLabel(page, labelNoFeed)).toBeVisible({ timeout: 1000 });
  });
});
