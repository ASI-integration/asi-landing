import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261003150000_booking_availability_account_scope_v1.sql'),
  'utf8',
);

describe('booking availability account-scope migration', () => {
  it('adds account lineage and an account-bound atomic hold path', () => {
    expect(migration).toContain('add column if not exists account_id text');
    expect(migration).toContain('create_booking_availability_hold_atomic_account_v1');
    expect(migration).toContain('where p.id::text = v_property_id and p.account_id::text = p_account_id');
    expect(migration).toContain('where r.id = p_booking_id');
    expect(migration).toContain('and r.account_id = p_account_id');
    expect(migration).toContain('h.account_id = p_account_id');
    expect(migration).toContain('b.account_id = p_account_id');
    expect(migration).toContain('where id = p_booking_id and account_id = p_account_id');
  });
});
