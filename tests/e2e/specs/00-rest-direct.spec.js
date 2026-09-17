// tests/e2e/specs/00-rest-direct.spec.js
// Direct-REST checks that need no frontend at all (contract.md §6.F, tasks.md §2 item 2).
// Run with: npx playwright test --project=rest-direct
//
// Covers:
//   AC-5.2  — DB itself rejects a POST/PATCH that tries to set created_at (401/403, 42501)
//   AC-11.1 — after a soft delete, the row still exists with deleted_at set
//   AC-11.2 — a direct REST DELETE is rejected (401/403, 42501) and the row still exists
//
// NOTE: on 2026-09-17 this sandbox's egress proxy blocked raw HTTPS to *.supabase.co
// (403, organization policy — the "network allowlist" case architecture.md §7 step 7.5
// anticipates). All three ACs were verified another way instead — via the Supabase MCP
// connector's execute_sql tool running `set role anon; <statement>;`, which exercises the
// identical grants/RLS policies PostgREST enforces. See
// tests/e2e/evidence/ac-5.2-11.1-11.2-sql-verification.json for that transcript and result
// (all three PASS). This spec is still the correct literal-REST version and should be run
// for real (`npx playwright test --project=rest-direct`) whenever *.supabase.co is reachable
// from wherever this suite runs — e.g. once the full suite runs against LIVE_URL.

'use strict';

const { test, expect } = require('@playwright/test');
const rest = require('../helpers/rest');
const { QA_LOGGED_BY } = require('../config');

test.describe('Direct REST checks (contract.md §6.F)', () => {
  test.afterAll(async () => {
    await rest.softDeleteAllByLoggedBy(QA_LOGGED_BY);
  });

  test('AC-5.2a — POST with created_at is rejected (401/403, 42501)', async () => {
    const r = await rest.attemptPostWithCreatedAt();
    expect([401, 403]).toContain(r.status);
    expect(r.body && r.body.code).toBe('42501');
    // And it must not have actually inserted a row with our forced timestamp.
    const leaked = await rest.getRaw(
      `?select=id&logged_by=eq.${encodeURIComponent(QA_LOGGED_BY)}&created_at=eq.2020-01-01T00%3A00%3A00%2B00%3A00`
    );
    expect(leaked.length).toBe(0);
  });

  test('AC-5.2b — PATCH trying to set created_at is rejected (401/403, 42501)', async () => {
    const row = await rest.insertFeed({ logged_by: QA_LOGGED_BY });
    try {
      const r = await rest.attemptPatchCreatedAt(row.id);
      expect([401, 403]).toContain(r.status);
      expect(r.body && r.body.code).toBe('42501');

      const after = await rest.getById(row.id);
      expect(after).not.toBeNull();
      expect(after.created_at).toBe(row.created_at); // unchanged
    } finally {
      await rest.softDeleteById(row.id);
    }
  });

  test('AC-11.2 — direct REST DELETE is rejected and the row still exists', async () => {
    const row = await rest.insertFeed({ logged_by: QA_LOGGED_BY });
    try {
      const r = await rest.attemptHardDelete(row.id);
      expect([401, 403]).toContain(r.status);
      expect(r.body && r.body.code).toBe('42501');

      const after = await rest.getById(row.id);
      expect(after).not.toBeNull();
      expect(after.id).toBe(row.id);
    } finally {
      await rest.softDeleteById(row.id);
    }
  });

  test('AC-11.1 — after a soft delete the row still exists with deleted_at set', async () => {
    const row = await rest.insertFeed({ logged_by: QA_LOGGED_BY });
    const deletedRows = await rest.softDeleteById(row.id);
    expect(deletedRows.length).toBe(1);
    expect(deletedRows[0].deleted_at).not.toBeNull();

    // "Check with the REST query deleted_at=not.is.null" (AC-11.1).
    const viaNotIsNull = await rest.getRaw(
      `?select=id,deleted_at&id=eq.${encodeURIComponent(row.id)}&deleted_at=not.is.null`
    );
    expect(viaNotIsNull.length).toBe(1);
    expect(viaNotIsNull[0].id).toBe(row.id);
    expect(viaNotIsNull[0].deleted_at).not.toBeNull();

    // Row was soft-deleted, never hard-deleted: still fetchable by id at all.
    const stillThere = await rest.getById(row.id);
    expect(stillThere).not.toBeNull();
  });

  test('sanity — soft-delete is idempotent (200 with []) per contract.md §6.D', async () => {
    const row = await rest.insertFeed({ logged_by: QA_LOGGED_BY });
    await rest.softDeleteById(row.id);
    const second = await rest.softDeleteById(row.id); // deleted_at=is.null filter now excludes it
    expect(second).toEqual([]);
  });
});
