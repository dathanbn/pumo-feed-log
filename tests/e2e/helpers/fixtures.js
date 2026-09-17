// tests/e2e/helpers/fixtures.js
// Base `test`/`expect` for every spec. Automatically resets QA-test data before each
// scenario (tasks.md §2 "Data hygiene": "Before each scenario, soft-delete every live
// QA-test row ... so counts and guards start clean").

'use strict';

const base = require('@playwright/test');
const rest = require('./rest');

const test = base.test.extend({});

// Escape hatch for a local/offline validation run against a static server with no reachable
// Supabase project (e.g. this sandbox's network policy) — never set for a real run against
// the live deploy, where this cleanup is required by tasks.md §2 "Data hygiene".
const SKIP_REST_CLEANUP = process.env.QA_SKIP_REST_CLEANUP === '1';

test.beforeEach(async () => {
  if (SKIP_REST_CLEANUP) return;
  await rest.softDeleteAllByLoggedBy();
});

module.exports = { test, expect: base.expect };
