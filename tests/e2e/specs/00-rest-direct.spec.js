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

  // v1.2 (contract.md §1/§3/§6.H): the update grant on created_at was widened so a feed's
  // logged time can be corrected (F21). AC-5.2's ORIGINAL wording ("PATCH that tries to set
  // created_at is rejected, 42501") is now stale for a PAST value — this is an intentional
  // contract change, not a regression; see docs-drift note in tests/qa-report.md §4. A future
  // value is still rejected, just by a different mechanism (23514, the CHECK constraint, not
  // 42501, a missing grant) — that case is AC-5.2c below, plus AC-21.4/21.8's own coverage in
  // specs/21-edit-time.spec.js.
  test('AC-5.2b (v1.2 update) — PATCH setting created_at to a PAST value now SUCCEEDS (contract.md §6.H); pet_id/logged_by remain untouched', async () => {
    const row = await rest.insertFeed({ logged_by: QA_LOGGED_BY });
    try {
      const r = await rest.attemptPatchCreatedAt(row.id); // 2020-01-01, a past value
      expect(r.status).toBe(200);
      expect(r.body[0].created_at).toBe('2020-01-01T00:00:00+00:00');

      const after = await rest.getById(row.id);
      expect(after).not.toBeNull();
      expect(after.created_at).toBe('2020-01-01T00:00:00+00:00');
      expect(after.pet_id).toBe(row.pet_id); // untouched
      expect(after.logged_by).toBe(row.logged_by); // untouched
    } finally {
      await rest.softDeleteById(row.id);
    }
  });

  // v1.2, contract.md §8's must-fail table: "PATCH .../feeds body {created_at: now+1 day} ->
  // 400/409, 23514 (feeds_created_at_not_future) - this one now differs from v1.1: a past
  // created_at on this same call succeeds (see AC-5.2b above); only a future one is rejected."
  test('AC-5.2c (v1.2, new) — PATCH setting created_at more than 5 min in the future is rejected (400/409, 23514)', async () => {
    const row = await rest.insertFeed({ logged_by: QA_LOGGED_BY });
    try {
      const r = await rest.attemptPatchFutureCreatedAt(row.id);
      expect([400, 409]).toContain(r.status);
      expect(r.body && r.body.code).toBe('23514');

      const after = await rest.getById(row.id);
      expect(after.created_at).toBe(row.created_at); // unchanged — the rejected PATCH never applied
    } finally {
      await rest.softDeleteById(row.id);
    }
  });

  // v1.2, contract.md §6.H/§8: pet_id and logged_by are still never editable through PATCH,
  // even though created_at now is (AC-21.8).
  test('AC-21.8a (v1.2, new) — PATCH trying to change pet_id is rejected (401/403, 42501)', async () => {
    const pumoId = await rest.getPetIdBySlug('pumo');
    const zuumiId = await rest.getPetIdBySlug('zuumi');
    const row = await rest.insertFeed({ petId: zuumiId, logged_by: QA_LOGGED_BY });
    try {
      const r = await rest.attemptPatchPetId(row.id, pumoId);
      expect([401, 403]).toContain(r.status);
      expect(r.body && r.body.code).toBe('42501');

      const after = await rest.getById(row.id);
      expect(after.pet_id).toBe(zuumiId); // unchanged — still Zuumi's, never moved to Pumo's
    } finally {
      await rest.softDeleteById(row.id);
    }
  });

  test('AC-21.8b (v1.2, new) — PATCH trying to change logged_by is rejected (401/403, 42501)', async () => {
    const row = await rest.insertFeed({ logged_by: QA_LOGGED_BY });
    try {
      const r = await rest.attemptPatchLoggedBy(row.id, 'QA-test-hacked');
      expect([401, 403]).toContain(r.status);
      expect(r.body && r.body.code).toBe('42501');

      const after = await rest.getById(row.id);
      expect(after.logged_by).toBe(QA_LOGGED_BY); // unchanged
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
