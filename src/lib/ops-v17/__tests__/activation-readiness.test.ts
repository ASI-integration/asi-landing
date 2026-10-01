import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingData } from '../types';

type Row = Record<string, any>;
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, errors: {} as Record<string, string> }));

vi.mock('@/lib/pilot-readiness/repository', () => ({ getPilotReadinessForProperty: vi.fn().mockResolvedValue({ ready: true, checks: [{ id: 'operator', ok: true }], missingLabelsRu: [] }) }));

vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  let matches = (_row: Row) => true;
  let operation: 'select' | 'update' | 'insert' = 'select';
  let payload: Row | undefined;
  const rows = () => state.tables[table] ?? (state.tables[table] = []);
  const execute = () => {
    const error = state.errors[table] ? { message: state.errors[table] } : null;
    if (error) return { data: null, error };
    const selected = rows().filter(matches);
    if (operation === 'update' && payload) selected.forEach((row) => Object.assign(row, payload));
    if (operation === 'insert' && payload) rows().push(payload);
    return { data: selected, error: null };
  };
  const query: any = {
    select: () => query,
    eq: (key: string, value: unknown) => { const previous = matches; matches = (row: Row) => previous(row) && row[key] === value; return query; },
    update: (value: Row) => { operation = 'update'; payload = value; return query; },
    insert: (value: Row) => { operation = 'insert'; payload = value; return query; },
    maybeSingle: async () => { const result = execute(); return { ...result, data: result.data?.[0] ?? null }; },
    then: (resolve: (value: unknown) => void) => resolve(execute()),
  };
  return query;
} } }));
import { activatePilot } from '../service';

const readyData: OnboardingData = {
  business: { name: 'ASI Pilot' },
  owner: { name: 'Анна', phone: '+70000000000' },
  properties: [{ key: 'p1', name: 'Лесная', address: 'Лесная, 1' }],
  units: [{ key: 'u1', propertyKey: 'p1', name: '1' }],
  operations: { checkInTime: '15:00', checkOutTime: '12:00', cleaningRule: 'После выезда' },
  channelManager: { provider: 'manual_import', snapshotReady: true, status: 'synchronized' },
  reservations: { choice: 'skip', completed: true, criticalConflicts: 0, mappingsComplete: true, ledgerInitialized: true, directIntakeReady: true },
  communications: { guestChannel: 'telegram', workerChannel: 'phone', pilotMode: 'operator_assisted' },
  legalPayments: { legalMode: 'review', depositMode: 'review', mvdMode: 'review' },
  staff: [{ key: 'op1', name: 'Оператор', role: 'operator', contact: '+7111', propertyKeys: ['p1'] }],
  verification: [{ key: 'pilot_readiness', propertyKey: 'p1', status: 'passed' }],
};

beforeEach(() => {
  state.errors = {};
  state.tables = {
    ops_v17_onboardings: [{ id: 'o1', account_id: 'A', data: structuredClone(readyData), current_step: 'launch', pilot_activated_at: null }],
    ops_v17_module_state: [],
    properties: [{ id: 'property-A', account_id: 'A' }],
    ops_v17_audit_log: [],
  };
});

describe('pilot activation operational readiness gate', () => {
  it('activates an operator-assisted pilot only after operational checks pass', async () => {
    const result = await activatePilot('A', 'owner-A');
    expect(result.alreadyActive).toBe(false);
    expect(result.manualControls).toEqual(expect.arrayContaining([expect.stringContaining('оператор')]));
    expect(state.tables.ops_v17_onboardings[0].pilot_activated_at).toBeTruthy();
    expect(state.tables.ops_v17_audit_log.some((row) => row.action === 'pilot_activated')).toBe(true);
  });

  it('blocks questionnaire-ready automatic mode when sending is disabled', async () => {
    state.tables.ops_v17_onboardings[0].data.communications = {
      guestChannel: 'telegram', workerChannel: 'phone', pilotMode: 'automatic', scopedPilotSendingEnabled: false,
    };
    await expect(activatePilot('A', 'owner-A')).rejects.toThrow('launch_blocked');
    expect(state.tables.ops_v17_onboardings[0].pilot_activated_at).toBeNull();
  });

  it('blocks activation when the canonical account has no persisted property', async () => {
    state.tables.properties = [];
    await expect(activatePilot('A', 'owner-A')).rejects.toThrow('launch_blocked');
  });

  it('fails closed when operational dependency lookup fails', async () => {
    state.errors.properties = 'db unavailable';
    await expect(activatePilot('A', 'owner-A')).rejects.toThrow('operational_readiness_unavailable');
    expect(state.tables.ops_v17_onboardings[0].pilot_activated_at).toBeNull();
  });
  it('is idempotent after pilot activation', async () => {
    state.tables.ops_v17_onboardings[0].pilot_activated_at = '2026-10-01T08:00:00.000Z';
    const result = await activatePilot('A', 'owner-A');
    expect(result).toEqual({ activatedAt: '2026-10-01T08:00:00.000Z', alreadyActive: true });
    expect(state.tables.ops_v17_audit_log).toHaveLength(0);
  });
});
