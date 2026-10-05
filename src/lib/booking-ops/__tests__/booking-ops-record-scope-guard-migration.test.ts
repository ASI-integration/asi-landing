import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../../supabase/migrations/20261005090000_booking_ops_record_scope_guard_v1.sql', import.meta.url),
  'utf8',
);

describe('booking ops record scope guard migration', () => {
  it('guards canonical inserts against the properties account/property pair', () => {
    expect(migration).toContain('booking_ops_record_insert_scope_guard_v1');
    expect(migration).toMatch(/p\.id::text\s*=\s*btrim\(NEW\.property_id\)/i);
    expect(migration).toMatch(/p\.account_id::text\s*=\s*btrim\(NEW\.account_id\)/i);
    expect(migration).toMatch(/FOR SHARE/i);
    expect(migration).toContain('booking_ops_record_scope_mismatch');
  });

  it('is deliberately insert-only so legacy updates are not widened by this migration', () => {
    expect(migration).toMatch(/BEFORE INSERT ON public\.booking_ops_records/i);
    expect(migration).not.toMatch(/BEFORE\s+UPDATE/i);
    expect(migration).not.toMatch(/BEFORE\s+INSERT\s+OR\s+UPDATE/i);
  });

  it('keeps legacy, accountless and property-unbound inserts outside the canonical guard', () => {
    expect(migration).toMatch(/NEW\.account_id IS NULL/i);
    expect(migration).toMatch(/NEW\.account_id = 'legacy'/i);
    expect(migration).toMatch(/NEW\.property_id IS NULL/i);
  });

  it('keeps the trigger function privilege surface explicit', () => {
    expect(migration).toMatch(/SECURITY DEFINER/i);
    expect(migration).toMatch(/SET search_path = public/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.booking_ops_record_insert_scope_guard_v1\(\) FROM PUBLIC/i);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.booking_ops_record_insert_scope_guard_v1\(\) TO service_role/i);
  });
});
