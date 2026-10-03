import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261003141500_booking_inbound_intake_account_scope_v1.sql'),
  'utf8',
);

describe('booking inbound intake account-scope migration', () => {
  it('adds canonical account lineage and account-local idempotency', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id)');
    expect(migration).toContain('FROM public.booking_ops_records b');
    expect(migration).toContain('FROM public.properties p');
    expect(migration).toContain("COALESCE(account_id::text, 'unbound')");
    expect(migration).toContain('UNIQUE (account_scope_key, idempotency_key)');
    expect(migration).toContain('idx_booking_inbound_intake_events_account_created');
    expect(migration).toContain('idx_booking_inbound_intake_events_account_status');
  });
});
