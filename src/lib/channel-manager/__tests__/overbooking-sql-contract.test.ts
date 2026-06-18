import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const mvpSql = readFileSync(
  join(root, 'supabase/migrations/20260608000001_channel_manager_mvp.sql'),
  'utf8',
);
const guardrailsSql = readFileSync(
  join(root, 'supabase/migrations/20260609000001_channel_manager_api_first_guardrails.sql'),
  'utf8',
);
const shadowSql = readFileSync(
  join(root, 'supabase/migrations/20260609000002_channel_manager_shadow_mode.sql'),
  'utf8',
);

describe('channel manager overbooking SQL contract', () => {
  it('keeps mock reservations atomic, idempotent, non-negative, and auditable', () => {
    expect(mvpSql).toContain('GREATEST(total_units - booked_units - manual_blocked_units, 0)');
    expect(mvpSql).toContain('idx_cm_reservations_external_unique');
    expect(mvpSql).toContain('idx_cm_reservations_idempotency_unique');

    expect(guardrailsSql).toContain('CREATE OR REPLACE FUNCTION cm_create_reservation');
    expect(guardrailsSql).toContain('pg_advisory_xact_lock');
    expect(guardrailsSql).toContain('FOR UPDATE');
    expect(guardrailsSql).toContain("'duplicate_external_booking_id'");
    expect(guardrailsSql).toContain("'conflict', 'no_availability'");
    expect(guardrailsSql).toContain('INSERT INTO cm_channel_sync_logs');
    expect(guardrailsSql).toContain("'no_availability'");
  });

  it('keeps shadow mode internal, auditable, and discrepancy-aware', () => {
    expect(shadowSql).toContain('cm_shadow_booking_events');
    expect(shadowSql).toContain('cm_shadow_discrepancies');
    expect(shadowSql).toContain('external_availability_mismatch');
    expect(shadowSql).toContain('ALTER TABLE cm_shadow_booking_events ENABLE ROW LEVEL SECURITY');
    expect(shadowSql).toContain('auth.role() = \'service_role\'');
  });
});
