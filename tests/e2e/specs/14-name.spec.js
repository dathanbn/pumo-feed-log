// tests/e2e/specs/14-name.spec.js
// F14 — AC-14.1 through AC-14.6 ("by {name}" without logins).

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome } = require('../helpers/app');
const {
  logButton,
  nameCardHeading,
  nameInput,
  nameSaveButton,
  nameSkipButton,
  footerChangeLink,
  footerSetNameLink,
} = require('../helpers/selectors');
const { mockHomeData } = require('../helpers/mock');
const { shot } = require('../helpers/screenshot');

// None of these tests seed pumo.loggerName / pumo.namePromptDone — a genuinely fresh phone.

test.describe('F14 — "by {name}" without logins', () => {
  test('AC-14.1 — fresh phone shows the name card; it never blocks logging; unanswered -> logged_by: null', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);

    await expect(nameCardHeading(page)).toBeVisible();
    await expect(nameInput(page)).toBeVisible();
    await expect(nameSaveButton(page)).toBeVisible();
    await expect(nameSkipButton(page)).toBeVisible();
    await shot(page, { n: 14, screen: 'home', state: 'name-card', scheme: 'light' });

    await expect(logButton(page)).toHaveText('Log a feed', { timeout: 10000 });

    let postBody = null;
    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    );
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/rest/v1/feeds') && postBody === null) {
        try {
          postBody = JSON.parse(req.postData() || '{}');
        } catch {
          postBody = {};
        }
      }
    });
    await logButton(page).click(); // card still showing, unanswered
    const res = await postPromise;
    const row = (await res.json())[0];

    expect(postBody.logged_by, 'unanswered name card -> logged_by: null').toBeNull();
    await rest.softDeleteById(row.id);
  });

  test('AC-14.2 — saving "Sam" stores it, hides the card, and every later log sends logged_by "Sam"', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);
    await expect(nameCardHeading(page)).toBeVisible();

    await nameInput(page).fill('Sam');
    await nameSaveButton(page).click();
    await expect(nameCardHeading(page)).toHaveCount(0);

    let postBody = null;
    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    );
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/rest/v1/feeds') && postBody === null) {
        postBody = JSON.parse(req.postData() || '{}');
      }
    });
    await logButton(page).click();
    const row = (await postPromise.then((r) => r.json()))[0];
    expect(postBody.logged_by).toBe('Sam');
    await expect(page.getByText('by Sam')).toBeVisible();

    await rest.softDeleteById(row.id);
  });

  test('AC-14.2b — name sanitization: trim, collapse whitespace, 20-char cut; Save disabled while empty', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);

    await expect(nameSaveButton(page)).toBeDisabled();
    await nameInput(page).fill('   ');
    // Whitespace-only should still leave Save disabled per sanitizeName's "trim" rule producing "".
    // (If the app only disables on a raw-empty check, this specific assertion may reveal a defect —
    // that's the point of checking it explicitly.)
    await expect(nameSaveButton(page)).toBeDisabled();

    const RAW = '  Sam   Jonathan   Longname X  ';
    await nameInput(page).fill(RAW); // will be trimmed/collapsed/cut
    await expect(nameSaveButton(page)).toBeEnabled();
    await nameSaveButton(page).click();

    // Expected per contract.md §7.7: trim -> collapse whitespace -> cut to NAME_MAX_LENGTH (20).
    // design.md §3.7 also puts maxlength="20" on the <input> itself, and a real browser text
    // field enforces that on the RAW (pre-trim/collapse) value — including for Playwright's
    // fill(), confirmed by direct repro — before sanitizeName ever sees it. So the input's
    // actual value by the time Save is clicked is RAW's first 20 raw characters, not all 32;
    // sanitizeName's trim+collapse+cut(20) then runs on THAT. Compute expected the same way,
    // rather than cutting the untruncated 32-char string, which would overstate the result's
    // length whenever whitespace collapsing removes characters that maxlength already dropped.
    const fieldTruncated = RAW.slice(0, 20);
    const expected = fieldTruncated.trim().replace(/\s+/g, ' ').slice(0, 20);
    expect(expected.length, 'sanity: expected value should be <= NAME_MAX_LENGTH').toBeLessThanOrEqual(20);
    await expect(page.getByText(new RegExp('Logging as ' + expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeVisible();
  });

  test('FAIL-1 re-test — the name card is actually hidden (not just marked hidden) after Save', async ({
    page,
  }) => {
    // Re-tests the defect filed against frontend/css/styles.css: .name-card (and .banner,
    // .undo-notice, .older-error) had an unconditional `display: flex` with no `[hidden]`
    // override, so author-origin CSS beat the UA's `[hidden]{display:none}` and the card
    // stayed visually present/interactive after JS correctly set the `hidden` attribute.
    // The fix adds a global `[hidden] { display: none !important; }` rule (styles.css).
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);
    await expect(nameCardHeading(page)).toBeVisible();

    await nameInput(page).fill('Sam');
    await nameSaveButton(page).click();

    // The old defect's exact failure mode: toHaveCount(0) via getByRole (accessibility-tree,
    // hidden-aware) used to still find it via a getByText fallback that ignores display:none.
    await expect(nameCardHeading(page)).toHaveCount(0);
    const computed = await page.evaluate(() => {
      const el = document.getElementById('name-card');
      return el && { hasHiddenAttr: el.hasAttribute('hidden'), display: getComputedStyle(el).display };
    });
    expect(computed, 'expected #name-card to exist with hidden + display:none').toEqual({
      hasHiddenAttr: true,
      display: 'none',
    });
    await shot(page, { n: 14, screen: 'home', state: 'name-card-hidden', scheme: 'light', afterFix: true });
  });

  test('AC-14.3 — after Skip, the card never appears again on this phone; feeds show "by Someone"', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);
    await nameSkipButton(page).click();
    await expect(nameCardHeading(page)).toHaveCount(0);

    await page.reload({ waitUntil: 'load' }); // still same phone/context
    await expect(nameCardHeading(page)).toHaveCount(0, { timeout: 5000 });

    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    );
    await expect(logButton(page)).toHaveText('Log a feed', { timeout: 10000 });
    await logButton(page).click();
    const row = (await postPromise.then((r) => r.json()))[0];
    await expect(page.getByText('by Someone')).toBeVisible();
    await rest.softDeleteById(row.id);
  });

  test('AC-14.4 — footer reads the two documented variants and reopens the card', async ({ page }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);
    await expect(page.getByText('No name on this phone · Set name')).toBeVisible();
    await shot(page, { n: 14, screen: 'home', state: 'footer-no-name', scheme: 'light' });

    await footerSetNameLink(page).click();
    await expect(nameCardHeading(page)).toBeVisible();
    await nameInput(page).fill('Alex');
    await nameSaveButton(page).click();

    await expect(page.getByText('Logging as Alex · Change')).toBeVisible();
    await shot(page, { n: 14, screen: 'home', state: 'footer-with-name', scheme: 'light' });

    await footerChangeLink(page).click();
    await expect(nameCardHeading(page)).toBeVisible();
    await expect(nameInput(page)).toHaveValue('Alex'); // reopens filled with the current name
  });

  test('AC-14.5 — names render as plain text; an HTML-looking name never executes', async ({ page }) => {
    let alertFired = false;
    page.on('dialog', async (d) => {
      alertFired = true;
      await d.dismiss();
    });

    // A row can carry an arbitrarily long/unsanitized logged_by if written outside the app
    // (e.g. directly via REST) — sanitizeName's 20-char cut only applies when THIS phone
    // saves its own name, not to whatever the server returns. AC-14.5 must hold regardless.
    const malicious = '<img src=x onerror=alert(1)>';
    await mockHomeData(page, {
      recent: [{ id: 'x1', created_at: new Date().toISOString(), logged_by: malicious }],
      todayCount: 1,
    });
    await gotoHome(page);
    await page.waitForTimeout(500);

    expect(alertFired, 'the name must never execute as script').toBe(false);
    // It should show up as literal text (truncated to 20 chars by the time it's stored, but
    // the point here is "runs no script" and "shows literally" — checked via the DOM below).
    const html = await page.content();
    expect(html.includes('<img src=x onerror=')).toBe(false); // never injected as raw markup
    await expect(page.getByText(/<img src=x onerror=alert\(1\)>/)).toBeVisible();
  });

  test('AC-14.6 — if localStorage throws, the app still loads and logs; feeds show "by Someone"', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked in this test', 'SecurityError');
        },
      });
    });
    await mockHomeData(page, { recent: [], todayCount: 0 });

    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await gotoHome(page);
    await expect(logButton(page)).toHaveText('Log a feed', { timeout: 10000 });

    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    );
    await logButton(page).click();
    const row = (await postPromise.then((r) => r.json()))[0];
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });
    await expect(page.getByText('by Someone')).toBeVisible();

    expect(pageErrors, `localStorage throwing must not crash the app: ${pageErrors.join('; ')}`).toEqual([]);
    await rest.softDeleteById(row.id);
  });
});
