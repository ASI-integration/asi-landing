import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { metadata: { acceptance_safe: true } as Record<string, unknown>, status: 'inquiry', stage: null as string | null, events: new Set<string>(), failType: '' };
const rows = { reservation: () => ({ id: 'record-1', booking_id: 'source-1', account_id: 'account-1', asi_reference: 'ASI-100002', normalized_status: state.status, property_id: 'property-1', reservation_metadata: state.metadata }) };

function query(table: string) {
  const filters: Record<string, unknown> = {};
  const api: Record<string, unknown> = {
    select: vi.fn(() => api), or: vi.fn(() => api), eq: vi.fn((key: string, value: unknown) => { filters[key] = value; return api; }),
    update: vi.fn((patch: Record<string, unknown>) => { if (patch.normalized_status) state.status = String(patch.normalized_status); return api; }),
    maybeSingle: vi.fn(async () => table === 'booking_ops_records' ? { data: rows.reservation(), error: null } : { data: null, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve(table === 'booking_ops_worker_tasks' ? { data: ['cleaner','linen_worker','consumables','inspector'].map((assigned_role) => ({ assigned_role, status: 'completed' })), error: null } : { data: [], count: 0, error: null }),
  };
  return api;
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn((table: string) => query(table)) } }));
vi.mock('../lifecycle-autopilot-service', () => ({
  durableEventId: (...parts: string[]) => parts.join(':'),
  getBookingLifecycleSummary: vi.fn(async () => ({ domainEventCount: state.events.size, stage: state.stage, readiness: state.stage === 'closed' ? 'ready' : 'blocked', blockers: [], processingErrors: [] })),
  recordAndProcessBookingEvent: vi.fn(async (input: { id: string; type: string }) => {
    if (input.type === state.failType) throw new Error('injected_failure');
    const duplicate = state.events.has(input.id); state.events.add(input.id);
    if (input.type === 'booking.closed') state.stage = 'closed';
    return { duplicate, processed: !duplicate };
  }),
}));
vi.mock('../repository', () => ({ getBookingOpsRecord: vi.fn(async () => ({ id: 'record-1' })) }));
vi.mock('../tasks', () => ({ listBookingOpsTasksForRecord: vi.fn(async () => ({ ok: true, tasks: [] })) }));
vi.mock('../communication-orchestrator', () => ({ syncBookingOpsCommunications: vi.fn(async () => ({ ok: true })) }));

import { recordAndProcessBookingEvent } from '../lifecycle-autopilot-service';
import { runGoldenPathAcceptance } from '../golden-path-acceptance';

const run = (overrides: Record<string, unknown> = {}) => runGoldenPathAcceptance({ identifier: 'ASI-100002', accountId: 'account-1', actorId: 'actor-1', dryRun: false, confirm: true, featureEnabled: true, ...overrides });

describe('OPS v17.2 golden path acceptance runner', () => {
  beforeEach(() => { state.metadata = { acceptance_safe: true }; state.status = 'inquiry'; state.stage = null; state.events.clear(); state.failType = ''; vi.clearAllMocks(); });

  it('returns a complete non-mutating dry-run plan with no guest-sensitive fields', async () => {
    const report = await runGoldenPathAcceptance({ identifier: 'ASI-100002', accountId: 'account-1', actorId: 'actor-1' });
    expect(report.overall).toBe('PLANNED'); expect(report.steps).toHaveLength(21); expect(recordAndProcessBookingEvent).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toMatch(/guest(Name|Phone|Email|Telegram)/);
  });

  it('requires confirmation, feature enablement, and a safe reservation', async () => {
    await expect(run({ confirm: false })).rejects.toThrow('explicit_confirmation_required');
    await expect(run({ featureEnabled: false })).rejects.toThrow('golden_path_feature_disabled');
    state.metadata = {}; await expect(run()).rejects.toThrow('reservation_not_acceptance_safe');
  });

  it('reaches the canonical terminal value with all roles and no sends or external calls', async () => {
    const report = await run();
    expect(report.overall).toBe('PASS'); expect(report.finalLifecycleStage).toBe('closed'); expect(report.finalReservationStatus).toBe('checked_out');
    expect(Object.keys(report.workerTasks)).toEqual(expect.arrayContaining(['cleaner','linen_worker','consumables','inspector']));
    expect(report.readinessResult).toBe('ready'); expect(report.realMessagesSent).toBe(0); expect(report.externalCalls).toBe(0);
    expect(report.steps.find((x) => x.eventType === 'checkin.instructions_released')?.status).toBe('PASS');
  });

  it('is idempotent on an identical second run', async () => {
    await run(); const report = await run();
    expect(report.overall).toBe('PASS'); expect(report.idempotency.changed).toBe(false); expect(report.idempotency.duplicateEvents).toBe(21);
  });

  it('reports a failed step and never reports PASS', async () => {
    state.failType = 'deposit.confirmed'; const report = await run();
    expect(report.overall).toBe('FAIL'); expect(report.steps.at(-1)).toMatchObject({ eventType: 'deposit.confirmed', status: 'FAIL' });
  });
});
