import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  writes: vi.fn(() => { throw new Error('unexpected_write'); }),
  scope: vi.fn(), auth: vi.fn(), access: vi.fn(),
  legal: vi.fn(), physical: vi.fn(), lifecycle: vi.fn(), events: vi.fn(),
  recompute: vi.fn(), ensurePhysical: vi.fn(), initializeLifecycle: vi.fn(),
  mutableLifecycle: vi.fn(), orchestrator: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => {
    let rows = [...(mocks.tables[table] ?? [])];
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[key])); return query; },
      order: () => query,
      limit: (count: number) => { rows = rows.slice(0, count); return query; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
      insert: mocks.writes, upsert: mocks.writes, update: mocks.writes, delete: mocks.writes,
    };
    return query;
  }, rpc: mocks.writes },
}));
vi.mock('@/lib/booking-ops/repository', () => ({
  requireBookingOpsRecordScope: mocks.scope, getBookingOpsRecord: mocks.scope,
  updateBookingOpsRecord: mocks.writes,
}));
vi.mock('@/lib/booking-ops/guest-legal-deposit-mvd-execution', () => ({
  getGuestLegalReadiness: mocks.legal, recomputeGuestLegalReadiness: mocks.recompute,
  listGuestLegalEvents: mocks.events,
}));
vi.mock('@/lib/booking-ops/physical-readiness-execution', () => ({
  readPhysicalReadiness: mocks.physical, ensurePhysicalTasks: mocks.ensurePhysical,
}));
vi.mock('@/lib/booking-ops/lifecycle', () => ({
  readLifecycleStatus: mocks.lifecycle, getLifecycleStatus: mocks.mutableLifecycle,
  initializeLifecycleForBooking: mocks.initializeLifecycle,
  blockGate: mocks.writes, completeGate: mocks.writes, markGateInProgress: mocks.writes,
}));
vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: mocks.auth, requireOpsAdminSession: mocks.auth,
}));
vi.mock('@/app/api/dashboard/booking-ops/access', () => ({ requireBookingOpsApiAccess: mocks.access }));
vi.mock('@/lib/booking-ops/lifecycle-orchestrator', () => ({
  getBookingLifecycleOrchestratorSnapshot: mocks.orchestrator,
  applyBookingLifecycleManualOverride: mocks.writes, forceBookingLifecycleEscalation: mocks.writes,
  orchestrateBookingLifecycle: mocks.writes,
}));
vi.mock('@/lib/booking-ops/lifecycle-entry-adapter', () => ({ emitLifecycleForAction: mocks.writes }));

import { readGuestIntakeReleaseSnapshot } from '../guest-intake-checkin-release';
import { readLegalPaymentStatus } from '../legal-payment-autopilot';
import { GET as intakeGET } from '@/app/api/dashboard/booking-ops/guest-intake-release/route';
import { GET as releaseGET } from '@/app/api/dashboard/booking-ops/checkin-release/route';
import { GET as paymentGET } from '@/app/api/dashboard/booking-ops/legal-payment/route';
import { GET as legalGET } from '@/app/api/dashboard/guest-legal/status/route';
import { GET as orchestratorGET } from '@/app/api/dashboard/booking-ops/lifecycle-orchestrator/route';

const id = '11111111-1111-4111-8111-111111111111';
const scope = { accountId: 'account-a', propertyId: 'property-a' };
const request = () => new Request('http://localhost/?bookingId=requested-booking');
function noWrites() {
  for (const fn of [mocks.writes, mocks.recompute, mocks.ensurePhysical, mocks.initializeLifecycle, mocks.mutableLifecycle]) {
    expect(fn).not.toHaveBeenCalled();
  }
}
describe('dashboard GET reads persisted state without creating evidence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.tables = {
      booking_ops_guest_intake_sessions: [{
        id: 'session-a', booking_ops_record_id: id, intake_status: 'not_started', submitted_fields: {},
      }],
    };
    mocks.scope.mockResolvedValue({ id, bookingId: 'reservation-a', propertyId: scope.propertyId });
    mocks.auth.mockResolvedValue({ session: { userId: 'operator-a' } });
    mocks.access.mockResolvedValue({ ok: true, bookingId: id, ...scope });
    mocks.legal.mockResolvedValue({ status: 'incomplete', nextAction: 'persisted-action' });
    mocks.physical.mockResolvedValue({ finalReady: false });
    mocks.lifecycle.mockResolvedValue({ ok: false, error: 'lifecycle_not_initialized' });
    mocks.events.mockResolvedValue([{ id: 'event-a' }]);
    mocks.orchestrator.mockResolvedValue({ state: 'persisted' });
  });

  it('reads intake rows and retains blockers without mutating prerequisites', async () => {
    const before = structuredClone(mocks.tables);
    const result = await readGuestIntakeReleaseSnapshot(id, scope);
    expect(result.canPrepareCheckinReleaseDraft).toBe(false);
    expect(result.blockers).toContain('physical_readiness_blocked');
    expect(result.blockers).toContain('legal_gate_blocked');
    expect(mocks.tables).toEqual(before);
    expect(mocks.scope).toHaveBeenLastCalledWith(id, scope);
    expect(mocks.scope).toHaveBeenCalledTimes(3);
    noWrites();
  });

  it('does not create a missing intake session', async () => {
    mocks.tables = {};
    await expect(readGuestIntakeReleaseSnapshot(id, scope)).rejects.toThrow('guest_intake_not_initialized');
    noWrites();
  });

  it.each(['legal', 'physical'] as const)('does not create missing %s prerequisites', async key => {
    mocks[key].mockResolvedValue(null);
    await expect(readGuestIntakeReleaseSnapshot(id, scope)).rejects.toThrow('guest_intake_prerequisites_not_initialized');
    noWrites();
  });

  it('rejects ownership drift before returning the intake snapshot', async () => {
    mocks.scope.mockResolvedValueOnce({ id }).mockResolvedValueOnce({ id }).mockRejectedValueOnce(new Error('booking_scope_changed'));
    await expect(readGuestIntakeReleaseSnapshot(id, scope)).rejects.toThrow('booking_scope_changed');
    noWrites();
  });

  it('reads legal payment rows without initializing absent lifecycle', async () => {
    const result = await readLegalPaymentStatus(id, scope);
    expect(result.lifecycle).toBeNull();
    expect(result.bookingId).toBe(id);
    expect(mocks.lifecycle).toHaveBeenCalledWith(id);
    expect(mocks.scope).toHaveBeenLastCalledWith(id, scope);
    noWrites();
  });

  it('rejects ownership drift before returning legal payment state', async () => {
    mocks.scope.mockResolvedValueOnce({ id }).mockResolvedValueOnce({ id }).mockResolvedValueOnce({ id })
      .mockRejectedValueOnce(new Error('booking_scope_changed'));
    await expect(readLegalPaymentStatus(id, scope)).rejects.toThrow('booking_scope_changed');
    noWrites();
  });

  it.each([['intake', intakeGET], ['release', releaseGET], ['payment', paymentGET]] as const)(
    '%s GET uses the real pure reader with canonical scope', async (_name, call) => {
      const response = await call(request());
      expect(response.status).toBe(200);
      expect(mocks.scope).toHaveBeenCalledWith(id, scope);
      noWrites();
    },
  );

  it('guest legal GET returns persisted readiness and the latest event', async () => {
    const response = await legalGET(request());
    expect(await response.json()).toEqual({
      ok: true, status: { readiness: { status: 'incomplete', nextAction: 'persisted-action' }, nextAction: 'persisted-action', lastEvent: { id: 'event-a' } },
    });
    expect(mocks.scope).toHaveBeenLastCalledWith(id, scope);
    noWrites();
  });

  it('guest legal GET leaves missing readiness uninitialized', async () => {
    mocks.legal.mockResolvedValue(null);
    const response = await legalGET(request());
    expect((await response.json()).status.readiness).toBeNull();
    expect(mocks.events).not.toHaveBeenCalled();
    noWrites();
  });

  it('orchestrator GET explicitly disables initialization', async () => {
    expect((await orchestratorGET(request())).status).toBe(200);
    expect(mocks.orchestrator).toHaveBeenCalledWith(id, false, scope);
    noWrites();
  });

  it('all automatic GETs deny unauthenticated access before reading', async () => {
    mocks.auth.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 401 }) });
    for (const call of [intakeGET, releaseGET, paymentGET, legalGET, orchestratorGET]) {
      expect((await call(request())).status).toBe(401);
    }
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.scope).not.toHaveBeenCalled();
    noWrites();
  });

  it('all automatic GETs reject foreign bookings before reading', async () => {
    mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ ok: false }, { status: 403 }) });
    for (const call of [intakeGET, releaseGET, paymentGET, legalGET, orchestratorGET]) {
      expect((await call(request())).status).toBe(403);
    }
    expect(mocks.scope).not.toHaveBeenCalled();
    expect(mocks.orchestrator).not.toHaveBeenCalled();
    noWrites();
  });
});
