import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// STATIC schema contracts, not SQL execution or PostgreSQL race acceptance.
const sql = readFileSync('supabase/migrations/20261009114500_booking_ops_atomic_quota_v1.sql', 'utf8');
const policy = readFileSync('src/lib/booking-ops/communication-auto-send-policy.ts', 'utf8');
describe('atomic quota SQL static release-hold contract', () => {
  it('serializes both cap checks and insert under one account mutex transaction', () => {
    expect(sql).toContain('UPDATE public.booking_ops_auto_send_quota_mutex SET generation = generation + 1');
    const lock = sql.indexOf('SET generation = generation + 1');
    const booking = sql.indexOf('IF pol.max_auto_sends_per_booking_per_day IS NOT NULL THEN');
    const guest = sql.indexOf('IF pol.max_auto_sends_per_guest_per_day IS NOT NULL THEN');
    const insert = sql.indexOf('INSERT INTO public.booking_ops_auto_send_quota_reservations');
    expect(lock).toBeLessThan(booking);
    expect(booking).toBeLessThan(guest);
    expect(guest).toBeLessThan(insert);
    expect(sql).toContain("AT TIME ZONE 'UTC'");
  });
  it('binds tenant, booking and recipient to database-owned records', () => {
    expect(sql).toContain('b.account_id IS DISTINCT FROM p_account_id::text');
    expect(sql).toContain('d.booking_id IS DISTINCT FROM b.booking_id');
    expect(sql).toContain('i.booking_id IS DISTINCT FROM b.booking_id');
    expect(sql).toContain('id::text = b.property_id AND account_id = p_account_id FOR SHARE');
    expect(sql).toContain('p_recipient IS DISTINCT FROM recipient');
    expect(sql).toContain("i.actor_type <> 'guest'");
    expect(sql).toContain("code', 'quota_guest_identity_missing'");
  });
  it('uses account-scoped booking and cross-channel guest quotas; null skips cap checks', () => {
    expect(sql).toContain('account_id = p_account_id AND booking_key = b.booking_id');
    expect(sql).toContain('account_id = p_account_id AND guest_key = v_guest_key');
    expect(sql).toContain("lower(btrim(b.guest_email))");
    expect(sql).toContain('count_used >= pol.max_auto_sends_per_booking_per_day');
    expect(sql).toContain('count_used >= pol.max_auto_sends_per_guest_per_day');
    expect(sql).toContain('pol.max_auto_sends_per_booking_per_day <= 0');
    expect(sql).toContain('pol.max_auto_sends_per_guest_per_day <= 0');
    const signature = sql.slice(sql.indexOf('CREATE FUNCTION public.booking_ops_atomic_quota_v1'), sql.indexOf(') RETURNS jsonb'));
    expect(signature).not.toMatch(/\bp_[a-z_]*(?:_count|_cap|_limit)\b/);
  });
  it('holds crash/unknown states and refuses all replay rather than expiring capacity', () => {
    expect(sql).toContain("state IN ('held', 'dispatching', 'sent', 'uncertain')");
    expect(sql).toContain("state <> 'sent' OR quota_day = day_utc");
    expect(sql).toContain("p_phase = 'reserve' AND q.id IS NOT NULL");
    expect(sql).toContain("q.state <> 'held'");
    expect(sql).toContain('UNIQUE (account_id, intent_id, channel, recipient_hash)');
    expect(sql).toContain('UNIQUE (account_id, idempotency_key)');
    expect(sql).not.toMatch(/DELETE FROM public.booking_ops_auto_send_quota_reservations/i);
    expect(sql).not.toContain("state = 'released'");
  });
  it('does not expose mutation authority or forgeable reservations to API roles', () => {
    expect(sql).toContain("SECURITY DEFINER SET search_path = ''");
    expect(sql).toContain('FROM PUBLIC, anon, authenticated, service_role');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT SELECT ON public.booking_ops_auto_send_quota_reservations TO service_role');
    expect(sql).not.toMatch(/GRANT (?:ALL|INSERT|UPDATE|DELETE).*quota_reservations/i);
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]+TO (?:anon|authenticated|PUBLIC)/i);
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });
  it('rechecks revocation and guards old sending claims without enabling anything', () => {
    expect(sql).toContain('IF g.emergency_stop OR g.actual_send_enabled THEN');
    expect(sql).toContain('OR sc.dry_run_only OR sc.emergency_stop');
    expect(sql).toContain('q.policy_updated_at IS DISTINCT FROM pol.updated_at');
    expect(sql).toContain('q.scope_updated_at IS DISTINCT FROM sc.updated_at');
    expect(sql).toContain("RAISE EXCEPTION 'atomic_quota_reservation_required'");
    expect(sql).toContain('BEFORE INSERT OR UPDATE ON public.booking_ops_communication_deliveries');
    expect(sql).not.toMatch(/SET actual_send_enabled\s*=\s*true/i);
  });
  it('blocks legacy unknown outcomes rather than undercounting at rollout', () => {
    expect(sql).toContain('quota_legacy_reconciliation_required');
    expect(sql).toContain("old.status IN ('sending', 'failed')");
    expect(sql).toContain("a.result = 'sent'");
    expect(sql).toContain("q.quota_day <> day_utc");
  });
  it('preserves parent count failure and malformed supplied-count protection', () => {
    expect(policy).toContain('Number.isSafeInteger(value)');
    expect(policy).toContain('Number(value) >= 0');
    expect(policy).toContain("rate.booking_daily_unavailable");
    expect(policy).toContain("rate.guest_daily_unavailable");
  });
});
