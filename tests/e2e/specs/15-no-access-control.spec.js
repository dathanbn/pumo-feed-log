// tests/e2e/specs/15-no-access-control.spec.js
// F15 — AC-15.1: a fresh browser with no stored data can view, log, undo and delete right
// away. No login, PIN or account screen exists anywhere.

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, gotoHistory } = require('../helpers/app');
const { logButton, undoNotice, undoButton } = require('../helpers/selectors');
const { mockHomeData } = require('../helpers/mock');

test.describe('F15 — No access control (intentional)', () => {
  test('AC-15.1 — fresh browser: no login/PIN/account screen; can view, log, undo, delete immediately', async ({
    page,
  }) => {
    await mockHomeData(page, { recent: [], todayCount: 0 });
    await gotoHome(page);

    // No login/PIN/account gate anywhere.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByText(/sign in|log in|enter pin|create account|forgot password/i)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // View: data is visible right away (no gate before the headline/button render).
    await expect(logButton(page)).toBeVisible();

    // Log immediately.
    const postPromise = page.waitForResponse(
      (res) => res.request().method() === 'POST' && res.url().includes('/rest/v1/feeds')
    );
    await expect(logButton(page)).toHaveText('Log a feed', { timeout: 10000 });
    await logButton(page).click();
    const row = (await postPromise.then((r) => r.json()))[0];
    await expect(logButton(page)).toHaveText(/Logged/, { timeout: 3000 });

    // Undo immediately, no confirmation gate.
    await undoButton(page).click();
    await expect
      .poll(async () => {
        const r = await rest.getById(row.id);
        return r && r.deleted_at !== null;
      }, { timeout: 3000 })
      .toBeTruthy();
    await expect(undoNotice(page)).toContainText('Feed removed');

    // Delete (on a fresh row) is reachable right away too, with only the in-app confirmation
    // (no login gate before getting to it).
    const row2 = await rest.insertFeed({ logged_by: 'QA-test' });
    await gotoHistory(page);
    const deleteBtn = page.getByRole('button', { name: /^Delete feed from .+, by .+$/ }).first();
    await expect(deleteBtn).toBeVisible();
    await rest.softDeleteById(row2.id);
  });

  test('AC-15.1b — history is reachable and usable with no stored data either', async ({ page }) => {
    await gotoHistory(page); // real network, no seeding
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
