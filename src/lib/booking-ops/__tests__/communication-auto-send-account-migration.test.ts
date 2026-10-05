import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20261003124500_booking_ops_auto_send_account_scope_v1.sql',
  ),
  'utf8',
);

describe('auto-send account scope migration contract', () => {
  it('adds canonical account lineage to scopes, runs and deliveries', () => {
    expect(migration).toContain(
      'ALTER TABLE public.booking_ops_communication_auto_send_scopes',
    );
    expect(migration).toContain(
      'ALTER TABLE public.booking_ops_communication_auto_send_runs',
    );
    expect(migration).toContain(
      'ALTER TABLE public.booking_ops_communication_deliveries',
    );
    expect(migration.match(/ADD COLUMN IF NOT EXISTS account_id UUID/g)?.length)
      .toBe(3);
  });

  it('disables legacy non-global scopes before attempting ownership backfill', () => {
    const disable = migration.indexOf(
      'UPDATE public.booking_ops_communication_auto_send_scopes\nSET actual_send_enabled = false',
    );
    const bookingBackfill = migration.indexOf('WITH booking_matches AS');
    expect(disable).toBeGreaterThanOrEqual(0);
    expect(bookingBackfill).toBeGreaterThan(disable);
  });

  it('backfills booking and property ownership only from canonical account sources', () => {
    expect(migration).toContain('JOIN public.booking_ops_records b');
    expect(migration).toContain('JOIN public.accounts a');
    expect(migration).toContain('a.id::text = b.account_id');
    expect(migration).toContain('COUNT(DISTINCT a.id) = 1');
    expect(migration).toContain('JOIN public.properties p');
    expect(migration).toContain('COUNT(DISTINCT p.account_id) = 1');
  });

  it('replaces global scope uniqueness with account + type + ref uniqueness', () => {
    expect(migration).toContain(
      "GENERATED ALWAYS AS (COALESCE(account_id::text, 'global')) STORED",
    );
    expect(migration).toContain('booking_ops_auto_send_scope_account_unique');
    expect(migration).toContain(
      'UNIQUE (account_scope_key, scope_type, scope_ref_key)',
    );
  });

  it('keeps unbound legacy scopes fail-closed', () => {
    expect(migration).toContain('booking_ops_auto_send_scope_account_guard');
    expect(migration).toContain(
      'OR (actual_send_enabled = false AND dry_run_only = true)',
    );
  });

  it('backfills delivery account lineage only through a canonical account match', () => {
    expect(migration).toContain('FROM public.booking_ops_communication_intents i');
    expect(migration).toContain('JOIN public.booking_ops_records b');
    expect(migration).toContain('JOIN public.accounts a');
    expect(migration).toContain('SET account_id = a.id');
    expect(migration).toContain('a.id::text = b.account_id');
    expect(migration).toContain('d.communication_intent_id = i.id');
  });
});
