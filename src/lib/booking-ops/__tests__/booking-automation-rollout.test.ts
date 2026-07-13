import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runAutomation: vi.fn(),
  reconcileAlerts: vi.fn(),
  from: vi.fn(),
}));

vi.mock('../booking-automation-runner', () => ({ runBookingOpsAutomationForBooking: mocks.runAutomation }));
vi.mock('../events', () => ({ recordBookingOpsEvent: vi.fn() }));
vi.mock('../operator-alerts', () => ({ reconcileOperatorAlertConditions: mocks.reconcileAlerts }));
vi.mock('../pre-checkin-alert-engine', () => ({
  PRE_CHECKIN_ALERT_SOURCE_DOMAINS: ['pre_checkin'],
  evaluatePreCheckinAlerts: vi.fn(() => []),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from, rpc: vi.fn() } }));

import {
  isBookingAutomationExecutionAllowed,
  resolveBookingAutomationCanaryBookingIds,
  resolveBookingAutomationRolloutMode,
} from '../booking-automation-rollout';
import { orchestrateBookingAutomationAndAlertsForBooking } from '../ops-alert-orchestrator';

const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-07-13T09:00:00.000Z';

function query(data: unknown = []) {
  const value = { data, error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'not', 'lte', 'gte', 'order', 'limit', 'in']) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: Array.isArray(data) ? data[0] ?? null : data, error: null }));
  chain.then = (resolveValue: (input: typeof value) => unknown) => Promise.resolve(value).then(resolveValue);
  return chain;
}

function automationSummary() {
  return {
    runId: 'automation-run', bookingId: BOOKING_ID, accountId: 'account-secret', startedAt: NOW, completedAt: NOW,
    lockAcquired: false,
    planned: [{
      code: 'prepare_contract', domain: 'legal', gateKey: 'contract_ready', disposition: 'approval_required',
      reasonCode: 'contract_approval_required', requiresApproval: true, retryAt: null,
      safeMetadata: { guestName: 'Must not leak', phone: '+70000000000' },
    }],
    executed: [], waiting: [], retriesScheduled: [], approvalsRequired: [], handoffsCreated: 0,
    alertsCreated: 0, alertsResolved: 0, errors: [],
  };
}

describe('booking automation rollout guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.runAutomation.mockResolvedValue(automationSummary());
    mocks.reconcileAlerts.mockResolvedValue({ alertsCreated: 1, alertsUpdated: 0, alertsEscalated: 0, alertsResolved: 0, unchanged: 0 });
    mocks.from.mockImplementation((table: string) => query(table === 'booking_ops_records'
      ? [{ id: BOOKING_ID, account_id: 'account-1', property_id: 'property-1', ops_status: 'checked_in', check_in_at: NOW }]
      : []));
  });

  it('defaults missing mode to shadow', () => {
    expect(resolveBookingAutomationRolloutMode(undefined)).toBe('shadow');
  });

  it('fails closed for unknown or malformed modes', () => {
    expect(resolveBookingAutomationRolloutMode('enabled')).toBe('shadow');
    expect(resolveBookingAutomationRolloutMode('ACTIVE')).toBe('shadow');
    expect(resolveBookingAutomationRolloutMode(' active ')).toBe('shadow');
    expect(resolveBookingAutomationRolloutMode({ mode: 'active' })).toBe('shadow');
  });

  it('parses an exact, trimmed and deduplicated canary allowlist', () => {
    expect([...resolveBookingAutomationCanaryBookingIds(` ${BOOKING_ID},other,${BOOKING_ID}, `)]).toEqual([BOOKING_ID, 'other']);
  });

  it('allows only active or an exact canary match and fails closed for an empty canary list', () => {
    expect(isBookingAutomationExecutionAllowed({ mode: 'shadow', bookingId: BOOKING_ID, canaryBookingIds: [BOOKING_ID] })).toBe(false);
    expect(isBookingAutomationExecutionAllowed({ mode: 'canary', bookingId: BOOKING_ID, canaryBookingIds: [] })).toBe(false);
    expect(isBookingAutomationExecutionAllowed({ mode: 'canary', bookingId: BOOKING_ID, canaryBookingIds: ['other'] })).toBe(false);
    expect(isBookingAutomationExecutionAllowed({ mode: 'canary', bookingId: BOOKING_ID, canaryBookingIds: [BOOKING_ID] })).toBe(true);
    expect(isBookingAutomationExecutionAllowed({ mode: 'active', bookingId: BOOKING_ID, canaryBookingIds: [] })).toBe(true);
  });

  it('keeps a startup-style shadow run in preview while preserving legacy alert reconciliation', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'shadow');
    const result = await orchestrateBookingAutomationAndAlertsForBooking({ bookingId: BOOKING_ID, now: NOW, reconcileLegacyInPreview: true });
    expect(mocks.runAutomation).toHaveBeenCalledWith(expect.objectContaining({ bookingId: BOOKING_ID, dryRun: true }));
    expect(mocks.reconcileAlerts).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ automationMode: 'shadow', automationExecutedCount: 0, automationPreviewCount: 1, alertsCreated: 1 });
  });

  it('returns only allowlisted preview fields and creates no hypothetical automation handoff alert', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'shadow');
    const result = await orchestrateBookingAutomationAndAlertsForBooking({ bookingId: BOOKING_ID, now: NOW, reconcileLegacyInPreview: true });
    expect(result.automation).toBeUndefined();
    expect(result.automationPreview).toEqual({
      bookingId: BOOKING_ID,
      plannedActions: [{ actionCode: 'prepare_contract', disposition: 'approval_required', reasonCode: 'contract_approval_required', retryAt: null, requiresApproval: true, requiresHandoff: false }],
    });
    expect(JSON.stringify(result.automationPreview)).not.toMatch(/account-secret|guestName|phone|Must not leak/);
    expect(mocks.reconcileAlerts).toHaveBeenCalledWith(expect.not.objectContaining({ managedSourceDomains: ['automation'] }));
  });

  it('uses preview behavior for an empty canary allowlist', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'canary');
    vi.stubEnv('BOOKING_OPS_AUTOMATION_CANARY_BOOKING_IDS', '');
    const result = await orchestrateBookingAutomationAndAlertsForBooking({ bookingId: BOOKING_ID });
    expect(mocks.runAutomation).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(result.automationExecutedCount).toBe(0);
  });

  it('executes a matching canary booking', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'canary');
    vi.stubEnv('BOOKING_OPS_AUTOMATION_CANARY_BOOKING_IDS', BOOKING_ID);
    const result = await orchestrateBookingAutomationAndAlertsForBooking({ bookingId: BOOKING_ID });
    expect(mocks.runAutomation).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }));
    expect(result).toMatchObject({ automationExecutedCount: 1, automationPreviewCount: 0, canaryMatchedCount: 1 });
  });

  it('previews a non-matching canary booking', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'canary');
    vi.stubEnv('BOOKING_OPS_AUTOMATION_CANARY_BOOKING_IDS', 'other');
    await orchestrateBookingAutomationAndAlertsForBooking({ bookingId: BOOKING_ID });
    expect(mocks.runAutomation).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('executes automation in active mode', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'active');
    await orchestrateBookingAutomationAndAlertsForBooking({ bookingId: BOOKING_ID });
    expect(mocks.runAutomation).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false }));
  });

  it('makes explicit dryRun override active execution and all legacy writes', async () => {
    vi.stubEnv('BOOKING_OPS_AUTOMATION_MODE', 'active');
    await orchestrateBookingAutomationAndAlertsForBooking({ bookingId: BOOKING_ID, dryRun: true, executeAutomation: true, reconcileLegacyInPreview: true });
    expect(mocks.runAutomation).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.reconcileAlerts).not.toHaveBeenCalled();
  });

  it('logs only rollout counters and the existing alert summary from the scheduler', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/ops-alert-scheduler.mjs'), 'utf8');
    for (const field of ['automationMode', 'automationExecutedCount', 'automationPreviewCount', 'canaryMatchedCount', 'created', 'updated', 'escalated', 'resolved', 'errors']) expect(source).toContain(field);
    for (const forbidden of ['guestName', 'executorContact', 'documentNumber', 'messageText', 'accessCode', 'paymentDetails']) expect(source).not.toContain(forbidden);
  });
});
