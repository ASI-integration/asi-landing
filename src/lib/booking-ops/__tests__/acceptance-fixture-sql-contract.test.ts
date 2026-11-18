import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const candidate = resolve(process.cwd(), 'scripts/acceptance/sql/asi-acceptance-fixture-candidate.sql');
const sql = readFileSync(candidate, 'utf8');

describe('single-row SQL acceptance fixture: fail-closed source contract', () => {
  it('requires explicit postgres-only approval before dropping the old overload', () => {
    expect(existsSync(candidate)).toBe(true);
    expect(sql).toContain("current_setting('asi.acceptance_fixture_migration_authorized', true)");
    expect(sql).toContain("RAISE EXCEPTION 'FIXTURE_MIGRATION_NOT_AUTHORIZED'");
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.asi_mark_acceptance_fixture(uuid,text,text,text);');
    expect(sql.indexOf('FIXTURE_MIGRATION_NOT_AUTHORIZED')).toBeLessThan(sql.indexOf('DROP FUNCTION IF EXISTS'));
    expect(sql).not.toContain('DROP FUNCTION IF EXISTS public.asi_mark_acceptance_fixture(uuid,text,text,text) CASCADE');
  });

  it('rejects every record, account or property except the three exact owner pins', () => {
    const ids = [
      'p_record_id IS DISTINCT FROM p_allowed_record_id',
      'p_account_id::uuid IS DISTINCT FROM p_allowed_account_id',
      'p_property_id::uuid IS DISTINCT FROM p_allowed_property_id',
    ];
    for (const id of ids) expect(sql).toContain(id);
    for (const arg of [
      'p_allowed_record_id uuid', 'p_allowed_account_id uuid',
      'p_allowed_property_id uuid',
      'p_allowed_record_id IS NULL', 'p_allowed_account_id IS NULL',
      'p_allowed_property_id IS NULL',
    ]) expect(sql).toContain(arg);
    expect(sql).not.toContain('__OWNER_PINNED_SYNTHETIC_');
    const first = sql.indexOf(ids[0]);
    const reject = sql.indexOf("RAISE EXCEPTION 'fixture_record_not_owner_pinned'", first);
    const firstLookup = sql.indexOf('SELECT * INTO v');
    expect(first).toBeGreaterThan(0);
    expect(reject).toBeGreaterThan(first);
    expect(reject).toBeLessThan(firstLookup);
  });

  it('requires explicit ASI SYNTHETIC guest prefix even for existing fixtures', () => {
    expect(sql).toContain("btrim(v.guest_name) !~* '^ASI[[:space:]_-]+SYNTHETIC[[:space:]_-]+'");
    expect(sql).toContain('fixture_new_record_requires_exact_synthetic_label');
    expect(sql).toContain('fixture_provenance_not_verified');
    expect(sql).toContain('v.booking_id IS NOT NULL');
    for (const field of ['guest_email', 'guest_phone', 'guest_telegram']) {
      expect(sql).toContain(field);
    }
  });

  it('requires the exact existing acceptance metadata and tenant-scoped no-send audit', () => {
    expect(sql).toContain("v.reservation_metadata->>'acceptance_source'");
    expect(sql).toContain("'owner_scoped_staging_fixture'");
    expect(sql).toContain("metadata->>'synthetic_only'='true'");
    expect(sql).toContain("metadata->>'no_send'='true'");
    expect(sql).toContain("metadata->>'account_id'=p_account_id");
    expect(sql).toContain("metadata->>'property_id'=p_property_id");
    expect(sql).toContain("RAISE EXCEPTION 'fixture_existing_provenance_or_audit_invalid'");
    const marker = sql.indexOf("IF v.reservation_metadata->>'acceptance_safe' = 'true'");
    expect(marker).toBeGreaterThan(0);
    expect(marker).toBeLessThan(sql.indexOf('UPDATE public.booking_ops_records'));
  });

  it('fails without a unique dedupe index, locks the record and never grants public execution', () => {
    expect(sql).toContain("idx.relname='idx_booking_ops_events_dedupe'");
    expect(sql).toContain('i.indisunique AND i.indisvalid AND i.indisready');
    expect(sql).toContain("RAISE EXCEPTION 'fixture_dedupe_unique_index_required'");
    expect(sql).toContain('FOR UPDATE;');
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.asi_mark_acceptance_fixture');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.asi_mark_acceptance_fixture');
    expect(sql).toContain('TO service_role;');
    expect(sql).toContain("IF current_user NOT IN ('postgres', 'service_role') THEN");
    expect(sql).toContain("RAISE EXCEPTION 'FORBIDDEN_ROLE'");
    expect(sql).toContain('(uuid,text,text,text,uuid,uuid,uuid)');
  });
  it('has an exact gated rollback and discloses the old-overload restore requirement', () => {
    const rollback = readFileSync(resolve(process.cwd(), 'scripts/acceptance/sql/asi-acceptance-fixture-rollback.sql'), 'utf8');
    expect(rollback).toContain("RAISE EXCEPTION 'FIXTURE_ROLLBACK_NOT_AUTHORIZED'");
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.asi_mark_acceptance_fixture(uuid,text,text,text,uuid,uuid,uuid);');
    expect(rollback).toContain('DOES NOT RECREATE the old FOUR-argument overload');
    expect(rollback).not.toContain(' CASCADE');
  });

});
