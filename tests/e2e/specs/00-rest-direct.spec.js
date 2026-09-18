// tests/e2e/specs/00-rest-direct.spec.js
// Direct-REST checks that need no frontend at all (contract.md §6.F, tasks.md §2 item 2).
// Run with: npx playwright test --project=rest-direct
//
// Covers:
//   AC-5.2  — DB itself rejects a POST/PATCH that tries to set created_at (401/403, 42501)
//   AC-11.1 — after a soft delete, the row still exists with deleted_at set
//   AC-11.2 — a direct REST DELETE is rejected (401/403, 42501) and the row still exists
//   v1.1 (contract.md §2/§6.G, tasks.md Task 1 preflight): GET /pets returns the 3 seeded
//     rows in sort_order; POST /pets is rejected (401/403, 42501); a feeds insert with no
//     pet_id is rejected by the not-null constraint.
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
const { QA_LOGGED_BY, PET_SLUGS } = require('../config');

test.describe('Direct REST checks (contract.md §6.F)', () => {
  test.afterAll(async () => {
    await rest.softDeleteAllByLoggedBy(QA_LOGGED_BY);
  });

  // -----------------------------------------------------------------------------------------
  // v1.1: pets (contract.md §6.G, §2, tasks.md Task 1 preflight items 1/3/6). These can only
  // pass once backend/schema.sql has actually been applied to the live project — until then,
  // expect getPets to fail with 404 PGRST205/42P01 (table doesn't exist) and attemptPostToPets
  // to fail for the same reason rather than the 42501 it's meant to prove. That distinction
  // matters: a 404 here means "run the migration", not "the RLS grants are wrong".
  // -----------------------------------------------------------------------------------------

  test('AC-17 preflight — GET pets returns 200 with exactly the 3 seeded rows, ascending sort_order', async () => {
    const pets = await rest.getPets({ fresh: true });
    expect(pets.length).toBe(PET_SLUGS.length);
    expect(pets.map((p) => p.slug)).toEqual(['pumo', 'zuumi', 'banh-mi']); // sort_order 0,1,2 per contract.md §2
    expect(pets.map((p) => p.sort_order)).toEqual([0, 1, 2]);
  });

  test('AC-17 preflight — POST /rest/v1/pets is rejected (401/403, 42501); the pet list is read-only from the client', async () => {
    const r = await rest.attemptPostToPets();
    expect([401, 403]).toContain(r.status);
    expect(r.body && r.body.code).toBe('42501');
  });

  test('AC-17.7-adjacent — insertFeed requires a real pet_id: an insert with no pet_id (or a bogus one) is rejected', async () => {
    // Not a contract.md "must fail" table entry verbatim, but follows directly from `pet_id
    // uuid references public.pets(id)` + `not null` (contract.md §1) — worth a direct check
    // since a build that forgets to send pet_id would otherwise only be caught by a UI test.
    const r = await rest.request('POST', '', {
      body: { logged_by: QA_LOGGED_BY }, // no pet_id at all
      prefer: 'return=representation',
    });
    expect(r.status, `expected a not-null-violation rejection, got ${r.status}: ${r.bodyText}`).toBeGreaterThanOrEqual(400);
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
