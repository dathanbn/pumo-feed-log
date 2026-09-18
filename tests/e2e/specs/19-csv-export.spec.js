// tests/e2e/specs/19-csv-export.spec.js
// F19 — CSV export of full feed history (v1.1). AC-19.1 through AC-19.5.
//
// SCAFFOLDING NOTE (pre-frontend-build pass): locators/expectations come from design.md
// §4.2/§5/§7 and contract.md §6.F.2/§7.9, not from real markup — frontend/ doesn't exist yet.
// feedsToCsvExpected/parseCsv/csvFilenameExpected (helpers/format.js) are QA's OWN
// reimplementation of contract.md §7.9's pure function, used only to compute what a test
// expects the downloaded file to contain — this file never imports frontend/js/logic.js.
// Every test here is expected to fail/time out until history.js wires up the Download CSV
// button (design.md §4.2) calling getAllFeedsForExport + feedsToCsv and triggering a
// client-side Blob download (contract.md §7.9's "no network request" — the button's OWN
// click triggers Playwright's `page.waitForEvent('download')`, which is how every test below
// captures the file). Per tasks.md §2 "Done means": "The CSV export was actually downloaded
// once during testing and its contents checked against the known seeded rows" — AC-19.1/19.3
// below do exactly that against real seeded data once this is runnable.

'use strict';

const fs = require('fs');
const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHistory, seedQaLoggerName } = require('../helpers/app');
const { csvDownloadButton, csvExportFailedText } = require('../helpers/selectors');
const { mockHistoryFirstPage, mockHistoryPages, fakeFeed } = require('../helpers/mock');
const { feedsToCsvExpected, parseCsv, csvFilenameExpected } = require('../helpers/format');
const net = require('../helpers/network');
const { shot } = require('../helpers/screenshot');
const { MS } = require('../helpers/time');
const { QA_LOGGED_BY, CONSTANTS, SUPABASE_URL } = require('../config');

test.describe('F19 — CSV export', () => {
  test.beforeEach(async ({ context }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
  });

  test('AC-19.1 — Download CSV downloads a .csv for the selected pet, header row "date,pet,time,feeder", real seeded rows round-trip', async ({
    page,
  }) => {
    // Real REST seed + real download: the strongest form of this AC (tasks.md §2's explicit
    // "actually downloaded ... checked against the known seeded rows" requirement).
    const seeded = [
      await rest.insertFeed({ petSlug: 'pumo', logged_by: 'Alex' }),
      await rest.insertFeed({ petSlug: 'pumo', logged_by: QA_LOGGED_BY }),
    ];
    try {
      await gotoHistory(page, 'pumo');
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
      await csvDownloadButton(page, 'Pumo').click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toMatch(/^pumo-feed-log-pumo-\d{4}-\d{2}-\d{2}\.csv$/);
      // Exact match against today's feedDayKey (contract.md §7.9) — the regex above is the
      // loose sanity check; this is the precise one.
      expect(download.suggestedFilename()).toBe(csvFilenameExpected('pumo'));

      const streamPath = await download.path();
      const text = fs.readFileSync(streamPath, 'utf8');
      const rows = parseCsv(text);
      expect(rows[0]).toEqual(['date', 'pet', 'time', 'feeder']);

      // Both seeded rows must be present with the right pet name and feeder.
      const feederColumn = rows.slice(1).map((r) => r[3]);
      expect(feederColumn).toContain('Alex');
      expect(feederColumn).toContain(QA_LOGGED_BY);
      for (const row of rows.slice(1)) {
        expect(row[1]).toBe('Pumo');
      }
      // \r\n line endings (contract.md §7.9) — spot-check the raw text, since parseCsv
      // normalizes line endings away.
      expect(text.includes('\r\n')).toBe(true);
    } finally {
      for (const row of seeded) await rest.softDeleteById(row.id).catch(() => {});
    }
  });

  // Fix round 1 (Opus review item 11): AC-19.1's header/filename/content claims are pure client
  // CSV-building logic (api.js's getAllFeedsForExport ~line 207, logic.js's feedsToCsv ~line
  // 431) — Playwright's real `download` event fires against a mocked GET exactly as it does
  // against a real one, so this doesn't need the real Supabase round trip the AC-19.1 test above
  // deliberately uses (tasks.md §2's own "actually downloaded" bar, kept there — this is
  // alongside it, not a replacement).
  test('AC-19.1b — mocked: Download CSV downloads a .csv for the selected pet, header row "date,pet,time,feeder", content round-trips', async ({
    page,
  }) => {
    const feeds = [
      fakeFeed({ id: 'csv-1', agoMs: MS.minutes(5), petSlug: 'pumo', loggedBy: 'Alex' }),
      fakeFeed({ id: 'csv-2', agoMs: MS.hours(2), petSlug: 'pumo', loggedBy: QA_LOGGED_BY }),
    ];
    await mockHistoryFirstPage(page, feeds);
    await gotoHistory(page, 'pumo');
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await csvDownloadButton(page, 'Pumo').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^pumo-feed-log-pumo-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(download.suggestedFilename()).toBe(csvFilenameExpected('pumo'));

    const streamPath = await download.path();
    const text = fs.readFileSync(streamPath, 'utf8');
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(['date', 'pet', 'time', 'feeder']);

    const feederColumn = rows.slice(1).map((r) => r[3]);
    expect(feederColumn).toContain('Alex');
    expect(feederColumn).toContain(QA_LOGGED_BY);
    for (const row of rows.slice(1)) {
      expect(row[1]).toBe('Pumo');
    }
    expect(text.includes('\r\n')).toBe(true); // contract.md §7.9
  });

  test('AC-19.2 — export fetches ALL pages via getAllFeedsForExport, not just what\'s been paged in on screen (>HISTORY_PAGE_SIZE rows)', async ({
    page,
  }) => {
    test.setTimeout(180_000); // seeding >100 real rows sequentially takes a while, per 12-history.spec.js's AC-12.3
    const n = CONSTANTS.HISTORY_PAGE_SIZE + 5;
    const before = (await rest.listLiveQaTestRows()).length;
    const seeded = await rest.seedFeeds(n, QA_LOGGED_BY, { petSlug: 'pumo' });
    try {
      await gotoHistory(page, 'pumo');
      // Deliberately do NOT click "Show older feeds" first — the point of AC-19.2 is that the
      // export doesn't depend on how many pages have been paged in on screen.
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
      await csvDownloadButton(page, 'Pumo').click();
      const download = await downloadPromise;
      const text = fs.readFileSync(await download.path(), 'utf8');
      const rows = parseCsv(text).filter((r) => r.length > 1); // drop header + trailing blank
      const dataRows = rows.slice(1);
      const qaTestRows = dataRows.filter((r) => r[3] === QA_LOGGED_BY);
      expect(qaTestRows.length).toBeGreaterThanOrEqual(n);
    } finally {
      for (const row of seeded) await rest.softDeleteById(row.id).catch(() => {});
      const after = (await rest.listLiveQaTestRows()).length;
      expect(after, 'no live QA-test rows should remain after this test').toBe(before);
    }
  });

  // Fix round 1 (Opus review item 11): AC-19.2's claim (export walks EVERY page, not just what's
  // on screen) is exactly what mockHistoryPages's multi-page cursor model exists to prove —
  // getAllFeedsForExport does its own independent no-cursor-then-cursor walk (confirmed by
  // reading api.js: it reuses getHistoryPage with the same limit/cursor shape as the on-screen
  // "Show older feeds" path), so a mocked 2-page fixture (100 + 5, matching the real AC-19.2
  // test's own n = HISTORY_PAGE_SIZE + 5 shape) exercises the identical pagination logic with no
  // real 105-row seed/cleanup round trip.
  test('AC-19.2b — mocked: export fetches ALL pages via getAllFeedsForExport, not just what\'s been paged in on screen (>HISTORY_PAGE_SIZE rows)', async ({
    page,
  }) => {
    const n = CONSTANTS.HISTORY_PAGE_SIZE + 5;
    const page1 = Array.from({ length: CONSTANTS.HISTORY_PAGE_SIZE }, (_, i) =>
      fakeFeed({ id: `exp1-${i}`, agoMs: MS.minutes(i + 1), petSlug: 'pumo', loggedBy: QA_LOGGED_BY })
    );
    const page2 = Array.from({ length: n - CONSTANTS.HISTORY_PAGE_SIZE }, (_, i) =>
      fakeFeed({ id: `exp2-${i}`, agoMs: MS.minutes(200 + i), petSlug: 'pumo', loggedBy: QA_LOGGED_BY })
    );
    await mockHistoryPages(page, [page1, page2]);
    await gotoHistory(page, 'pumo');
    // Deliberately do NOT click "Show older feeds" first — same point as the real AC-19.2 above:
    // the export must not depend on how many pages have been paged in on screen.
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await csvDownloadButton(page, 'Pumo').click();
    const download = await downloadPromise;
    const text = fs.readFileSync(await download.path(), 'utf8');
    const rows = parseCsv(text).filter((r) => r.length > 1); // drop header + trailing blank
    const dataRows = rows.slice(1);
    expect(dataRows.length).toBe(n);
    expect(dataRows.every((r) => r[3] === QA_LOGGED_BY)).toBe(true);
  });

  test('AC-19.3a — deleted feeds never appear in the export', async ({ page }) => {
    const live = await rest.insertFeed({ petSlug: 'pumo', logged_by: 'Alex' });
    const deleted = await rest.insertFeed({ petSlug: 'pumo', logged_by: 'ShouldNotAppear' });
    await rest.softDeleteById(deleted.id);
    try {
      await gotoHistory(page, 'pumo');
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
      await csvDownloadButton(page, 'Pumo').click();
      const text = fs.readFileSync(await (await downloadPromise).path(), 'utf8');
      expect(text).not.toContain('ShouldNotAppear');
      expect(text).toContain('Alex');
    } finally {
      await rest.softDeleteById(live.id).catch(() => {});
    }
  });

  test('AC-19.3b — a feeder name with a comma and a quote round-trips per RFC 4180', async ({ page }) => {
    const trickyName = 'Sam, "Jr."';
    const row = await rest.insertFeed({ petSlug: 'pumo', logged_by: trickyName });
    try {
      await gotoHistory(page, 'pumo');
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
      await csvDownloadButton(page, 'Pumo').click();
      const text = fs.readFileSync(await (await downloadPromise).path(), 'utf8');
      const rows = parseCsv(text);
      const feederColumn = rows.slice(1).map((r) => r[3]);
      expect(feederColumn).toContain(trickyName); // parseCsv un-escapes it back to the exact original
    } finally {
      await rest.softDeleteById(row.id).catch(() => {});
    }
  });

  test('AC-19.3c — feedsToCsvExpected fixture check: null logged_by -> "Someone", oldest-first row order, feed-day date column', async () => {
    // Pure-fixture check against QA's own reimplementation (sanity that the helper itself is
    // correct before relying on it above) — not a browser test.
    const pet = { slug: 'pumo', name: 'Pumo' };
    const feeds = [
      { created_at: '2026-09-17T14:42:07.000Z', logged_by: null }, // newest
      { created_at: '2026-09-16T10:00:00.000Z', logged_by: 'Sam, Jr.' }, // oldest
    ];
    const csv = feedsToCsvExpected(feeds, pet);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(['date', 'pet', 'time', 'feeder']);
    // oldest-first: the Sam row (2026-09-16) comes before the null row (2026-09-17).
    expect(rows[1][3]).toBe('Sam, Jr.');
    expect(rows[2][3]).toBe('Someone');
    expect(csv.startsWith('date,pet,time,feeder\r\n')).toBe(true);
  });

  // Fix round 1 (Opus review item 11): the comma/quote RFC 4180 round-trip (AC-19.3b) is pure
  // client CSV-escaping logic (logic.js's feedsToCsv), fully provable via a mocked GET. Kept as
  // its own test rather than folded into AC-19.1b so it stays a single, focused assertion, same
  // structure as the real AC-19.3b above. The "deleted feeds never appear" half of AC-19.3
  // (AC-19.3a) is deliberately NOT duplicated here: that's a server-side `deleted_at is null`
  // filter claim — a mock can only ever return what a test tells it to (there is no real
  // deleted-vs-live distinction to get wrong client-side), so mocking it would just prove the
  // mock itself echoes back what it was given, not that the app is safe. That half stays
  // real-network only (AC-19.3a above).
  test('AC-19.3d — mocked: a feeder name with a comma and a quote round-trips per RFC 4180', async ({ page }) => {
    const trickyName = 'Sam, "Jr."';
    await mockHistoryFirstPage(page, [fakeFeed({ agoMs: MS.minutes(5), petSlug: 'pumo', loggedBy: trickyName })]);
    await gotoHistory(page, 'pumo');
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await csvDownloadButton(page, 'Pumo').click();
    const text = fs.readFileSync(await (await downloadPromise).path(), 'utf8');
    const rows = parseCsv(text);
    const feederColumn = rows.slice(1).map((r) => r[3]);
    expect(feederColumn).toContain(trickyName); // parseCsv un-escapes it back to the exact original
  });

  test('AC-19.4a — while fetching, the control shows a busy state and can\'t be activated twice at once', async ({
    page,
  }) => {
    const row = await rest.insertFeed({ petSlug: 'pumo', logged_by: QA_LOGGED_BY });
    try {
      await net.addLatency(page, 2000, { urlPattern: `${SUPABASE_URL}/rest/v1/feeds**`, methodFilter: 'GET' });
      await gotoHistory(page, 'pumo');
      const btn = csvDownloadButton(page, 'Pumo');
      await btn.click();
      // design.md §4.2: "shows a spinner and 'Preparing…', disabled".
      await expect(btn).toHaveText(/Preparing…/, { timeout: 3000 });
      await expect(btn).toBeDisabled();
      await shot(page, { n: 19, screen: 'history', state: 'csv-preparing', scheme: 'light' });
    } finally {
      await rest.softDeleteById(row.id).catch(() => {});
    }
  });

  test('AC-19.4b — a mid-export page failure downloads no partial file and returns the control to normal, showing S15', async ({
    page,
  }) => {
    await mockHistoryFirstPage(page, [fakeFeed({ agoMs: MS.minutes(5), petSlug: 'pumo' })]);
    await gotoHistory(page, 'pumo');
    // Fail every GET after the first page loads, so getAllFeedsForExport's paging fails
    // partway through (contract.md §6.F.2: "On any page failing ... partial results are
    // discarded").
    await net.failWith5xx(page, { methodFilter: 'GET', status: 503 });

    let downloadFired = false;
    page.on('download', () => {
      downloadFired = true;
    });
    const btn = csvDownloadButton(page, 'Pumo');
    await btn.click();

    // design.md S15: "Couldn't prepare the download." with Retry, OR (frontend agent's
    // documented call) a persistent line under the button — check the build notes
    // (tests/qa-report.md §5) for which was chosen once known.
    await expect(csvExportFailedText(page)).toBeVisible({ timeout: 10000 });
    await expect(btn).toHaveText(/Download CSV/, { timeout: 5000 }); // back to normal, not stuck "Preparing…"
    await expect(btn).toBeEnabled();
    expect(downloadFired, 'no partial file should ever download on a failed export').toBe(false);
    await shot(page, { n: 19, screen: 'history', state: 'csv-failed', scheme: 'light' });
  });

  test('AC-19.5 — the button is reachable by keyboard and has an accessible name that includes the pet\'s name', async ({
    page,
  }) => {
    await mockHistoryFirstPage(page, []);
    await gotoHistory(page, 'zuumi');
    const btn = csvDownloadButton(page, 'Zuumi');
    await expect(btn).toBeVisible();
    // design.md §7 icon-only-control labeling rule + AC-19.5's exact pattern:
    // "Download Zuumi's feed history as CSV".
    const accessibleName = await btn.evaluate((el) => el.getAttribute('aria-label') || el.textContent);
    expect(accessibleName).toMatch(/Download Zuumi.s feed history as CSV|Download CSV/);

    await page.keyboard.press('Tab');
    // Keep tabbing until we land on the button or give up after a reasonable number of tries
    // (there's no documented tab-order guarantee this is the Nth focusable element).
    let found = false;
    for (let i = 0; i < 15; i++) {
      const isFocused = await btn.evaluate((el) => el === document.activeElement).catch(() => false);
      if (isFocused) {
        found = true;
        break;
      }
      await page.keyboard.press('Tab');
    }
    expect(found, 'Download CSV button should be reachable via Tab').toBe(true);
  });
});
