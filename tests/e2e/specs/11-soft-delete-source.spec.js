// tests/e2e/specs/11-soft-delete-source.spec.js
// F11 — AC-11.3: frontend/ contains no DELETE HTTP calls; Undo and Delete both call the
// same softDeleteFeed function. (AC-11.1/AC-11.2 are direct-REST checks — see
// specs/00-rest-direct.spec.js.)
//
// Pure source inspection, no browser needed. Run with:
//   npx playwright test --project=source-checks

'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FRONTEND_JS_DIR = path.resolve(__dirname, '..', '..', '..', 'frontend', 'js');

function listJsFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFilesRecursive(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test.describe('AC-11.3 — source checks (frontend/js)', () => {
  test('no DELETE HTTP calls anywhere in frontend/js; undo and delete share softDeleteFeed', async () => {
    const files = listJsFilesRecursive(FRONTEND_JS_DIR);
    if (files.length === 0) {
      test.skip(true, `frontend/js does not exist yet at ${FRONTEND_JS_DIR} — nothing to check until the frontend agent builds it.`);
      return;
    }

    const offenders = [];
    let softDeleteFeedDefined = false;
    let softDeleteFeedCallSites = 0;

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(FRONTEND_JS_DIR, file);

      // Literal 'DELETE' string anywhere (the app must never use the HTTP DELETE method;
      // contract.md §6.D and architecture.md §4 both forbid it for api.js).
      if (/DELETE/.test(src)) {
        // Report every occurrence with a line number for a precise defect report.
        src.split('\n').forEach((line, i) => {
          if (/DELETE/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }

      if (/export\s+(async\s+)?function\s+softDeleteFeed\b/.test(src) || /export\s+const\s+softDeleteFeed\s*=/.test(src)) {
        softDeleteFeedDefined = true;
      }
      const calls = src.match(/\bsoftDeleteFeed\s*\(/g);
      if (calls) softDeleteFeedCallSites += calls.length;
    }

    expect(
      offenders,
      `Found the literal string "DELETE" in frontend/js (contract.md §6.D / architecture.md §4 forbid the HTTP DELETE method anywhere in the app):\n${offenders.join('\n')}`
    ).toEqual([]);

    expect(softDeleteFeedDefined, 'api.js should export a softDeleteFeed function (contract.md §6.D)').toBeTruthy();
    expect(
      softDeleteFeedCallSites,
      'softDeleteFeed should be called from at least two places (undo and delete — architecture.md §4)'
    ).toBeGreaterThanOrEqual(2);
  });
});
