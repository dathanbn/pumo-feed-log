// tests/e2e/specs/05-server-timestamp.spec.js
// F5 — AC-5.1 (the app never sends created_at; the server's clock, not the phone's, wins).
// AC-5.2 (DB rejects a direct REST attempt to set created_at) is covered in
// specs/00-rest-direct.spec.js (and, for this sandbox, tests/e2e/evidence/... — see that
// spec's header comment).

'use strict';

const { test, expect } = require('../helpers/fixtures');
const rest = require('../helpers/rest');
const { gotoHome, seedQaLoggerName } = require('../helpers/app');
const { logButton } = require('../helpers/selectors');
const { mockHomeData } = require('../helpers/mock');
const { MS } = require('../helpers/time');
const { QA_LOGGED_BY } = require('../config');

test.describe('F5 — Server sets the timestamp', () => {
  test('AC-5.1 — no created_at in the POST body; server created_at is within 5s of real time even with the clock 3h ahead', async ({
    page,
    context,
  }) => {
    await seedQaLoggerName(context, QA_LOGGED_BY);
    await mockHomeData(page, { recent: [], todayCount: 0 });

    const realNowBeforeInstall = Date.now();
    await page.clock.install({ time: new Date(realNowBeforeInstall + MS.hours(3)) });
    await gotoHome(page);
    await expect(logButton(page)).toHaveText('Log a feed');

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

    await logButton(page).click();
    const res = await postPromise;
    const rows = await res.json();
    const row = rows[0];

    expect(postBody, 'captured POST body').not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(postBody, 'created_at')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(postBody, 'deleted_at')).toBe(false);

    const realNowAfter = Date.now(); // Node's real clock — unaffected by the page's faked clock
    const serverCreatedAtMs = Date.parse(row.created_at);
    const driftMs = Math.abs(serverCreatedAtMs - realNowAfter);
    expect(
      driftMs,
      `server created_at (${row.created_at}) should be within 5s of real wall-clock time despite the browser clock being 3h ahead; drift was ${driftMs}ms`
    ).toBeLessThanOrEqual(5000);

    // Also confirm directly against the database (bypassing the client entirely).
    const dbRow = await rest.getById(row.id);
    expect(dbRow).not.toBeNull();
    expect(Math.abs(Date.parse(dbRow.created_at) - realNowAfter)).toBeLessThanOrEqual(5000);

    await rest.softDeleteById(row.id);
  });
});
