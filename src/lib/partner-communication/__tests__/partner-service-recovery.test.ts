import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  PartnerRecoveryError,
  createPartnerRecoveryProcessor,
  createPartnerRecoveryRepository,
  deriveRecoveryMetrics,
  validateTrustedPartnerRecoveryEvent,
  type PartnerRecoveryDatabase,
} from '../recovery';
import { handlePartnerCommunicationEvent } from '../../../app/api/partner/v1/communication/events/route';

type Row = Record<string, any>;

class MemoryRecoveryDatabase implements PartnerRecoveryDatabase {
  cases: Row[] = [];
  events: Row[] = [];
  actions: Row[] = [];
  sessions: Row[] = [];

  async findCaseBySource(input: Row) { return this.cases.find((row) => row.account_id === input.accountId && row.source_decision_id === input.sourceDecisionId) as any ?? null; }
  async findCaseByRef(input: Row) { return this.cases.find((row) => row.account_id === input.accountId && row.public_recovery_ref === input.recoveryRef) as any ?? null; }
  async findActionByRef(input: Row) { return this.actions.find((row) => row.account_id === input.accountId && row.public_action_ref === input.actionRef) as any ?? null; }
  async getAction(input: Row) { return this.actions.find((row) => row.account_id === input.accountId && row.id === input.actionId) as any ?? null; }
  async findCaseByAction(input: Row) { return this.cases.find((row) => row.account_id === input.accountId && row.action_id === input.actionId) as any ?? null; }
  async findSessionScope(input: Row) { return this.sessions.find((row) => row.account_id === input.accountId && row.id === input.sessionId) as any ?? null; }
  async insertCase(row: Row) {
    if (await this.findCaseBySource({ accountId: row.account_id, sourceDecisionId: row.source_decision_id })) return { row: null, conflict: true };
    this.cases.push(structuredClone(row)); return { row: this.cases.at(-1) as any, conflict: false };
  }
  async updateCase(input: Row) {
    const row = this.cases.find((candidate) => candidate.account_id === input.accountId && candidate.id === input.caseId && candidate.status === input.expectedStatus);
    if (!row) return null; Object.assign(row, structuredClone(input.patch)); return row as any;
  }
  async findEvent(input: Row) {
    return this.events.find((row) => row.account_id === input.accountId && row.partner_id === input.partnerId
      && row.external_partner_account_id === input.externalPartnerAccountId && row.external_event_id === input.externalEventId) as any ?? null;
  }
  async insertEvent(row: Row) {
    if (this.events.some((candidate) => candidate.account_id === row.account_id && candidate.partner_id === row.partner_id
      && candidate.external_partner_account_id === row.external_partner_account_id
      && candidate.external_event_id === row.external_event_id)) return { row: null, conflict: true };
    this.events.push(structuredClone(row)); return { row: this.events.at(-1) as any, conflict: false };
  }
  async completeEvent(input: Row) {
    const row = this.events.find((candidate) => candidate.account_id === input.accountId && candidate.id === input.eventId)!;
    if (row.processed_at) throw new Error('duplicate completion');
    row.response = structuredClone(input.response); row.processed_at = input.processedAt;
  }
}

const principal = {
  accountId: '10000000-0000-4000-8000-000000000001', partnerId: 'apart-sharing',
  externalPartnerAccountId: 'account-101', credentialId: 'cred-1', partnerAccountBindingId: 'binding-1',
} as any;

function eventBase(eventId: string) {
  return {
    schemaVersion: 'partner.communication.v1', eventId, occurredAt: '2026-08-15T12:00:00.000Z',
    partner: { partnerId: 'apart-sharing', accountId: 'account-101' },
    property: { propertyId: 'apartment-101' }, booking: { bookingId: 'booking-101' },
    conversation: { conversationId: 'stay-101' },
  };
}

function operation(eventId: string, actionRef: string, status: string, resolutionSummary?: string) {
  return validateTrustedPartnerRecoveryEvent({ ...eventBase(eventId), eventType: 'operation.updated',
    operation: { actionRef, status, ...(resolutionSummary ? { resolutionSummary } : {}) } });
}

function confirmation(eventId: string, recoveryRef: string, satisfied: boolean) {
  return validateTrustedPartnerRecoveryEvent({ ...eventBase(eventId), eventType: 'guest.resolution.confirmed',
    confirmation: { recoveryRef, satisfied } });
}

async function setup(suffix: string) {
  const database = new MemoryRecoveryDatabase();
  const repository = createPartnerRecoveryRepository(database);
  const actionId = `20000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
  const sessionId = `30000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
  const actionRef = `pact_${suffix.padEnd(32, 'a')}`;
  database.actions.push({ id: actionId, account_id: principal.accountId, public_action_ref: actionRef, action_type: 'maintenance_issue' });
  database.sessions.push({ id: sessionId, account_id: principal.accountId, external_property_id: 'apartment-101',
    external_booking_id: 'booking-101', external_conversation_id: 'stay-101' });
  const recovery = await repository.openMaintenanceCase({
    accountId: principal.accountId, sessionId, sourceInboxId: `40000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    sourceDecisionId: `50000000-0000-4000-8000-${suffix.padStart(12, '0')}`, actionId, actionRef,
    handoffId: `60000000-0000-4000-8000-${suffix.padStart(12, '0')}`, issueSummary: 'Не работает отопление.',
    severity: 'high', openedAt: '2026-08-15T10:00:00.000Z',
  });
  const state = {
    actions: [] as Row[], handoffs: [] as Row[],
    async updatePartnerAction(input: Row) { this.actions.push(structuredClone(input)); return input as any; },
    async updatePartnerHandoff(input: Row) { this.handoffs.push(structuredClone(input)); return input as any; },
    async createOrReusePartnerHandoff(input: Row) { this.handoffs.push(structuredClone(input)); return { id: 'handoff-active', status: 'pending', ...input } as any; },
  };
  const process = createPartnerRecoveryProcessor(database, {
    resolveCanonical: (async () => ({ status: 'resolved', accountId: principal.accountId, propertyId: 'property-internal', bookingId: 'booking-internal' })) as any,
    state: state as any,
  });
  return { database, repository, recovery, actionRef, process, state };
}

describe('Partner Service Recovery Loop v1', () => {
  it('opens one maintenance case with opaque references and derives KPI latencies', async () => {
    const { database, repository, recovery, actionRef } = await setup('1');
    const replay = await repository.openMaintenanceCase({
      accountId: recovery.accountId, sessionId: recovery.sessionId, sourceInboxId: recovery.sourceInboxId,
      sourceDecisionId: recovery.sourceDecisionId, actionId: recovery.actionId!, actionRef,
      handoffId: recovery.handoffId, issueSummary: 'changed replay text is ignored by source uniqueness', severity: 'high', openedAt: recovery.openedAt,
    });
    expect(database.cases).toHaveLength(1);
    expect(replay.recoveryRef).toBe(recovery.recoveryRef);
    expect(recovery.recoveryRef).toMatch(/^prec_[A-Za-z0-9_-]{32,96}$/);
    expect(recovery.recoveryRef).not.toContain(recovery.id);
    expect(actionRef).toMatch(/^pact_[A-Za-z0-9_-]{32,96}$/);
    expect(actionRef).not.toContain(recovery.actionId!);
    expect(deriveRecoveryMetrics({ ...recovery, operationResolvedAt: '2026-08-15T10:30:00.000Z', guestConfirmedAt: '2026-08-15T10:40:00.000Z' }))
      .toEqual({ resolutionLatencyMs: 1_800_000, confirmationLatencyMs: 600_000, totalRecoveryLatencyMs: 2_400_000 });
  });

  it('runs the happy path, prepares one follow-up, and replays every event without side effects', async () => {
    const { database, recovery, actionRef, process, state } = await setup('2');
    const started = await process(principal, operation('event-started', actionRef, 'in_progress'));
    expect(started.recovery.status).toBe('in_progress');
    const [resolved] = await Promise.all([
      process(principal, operation('event-resolved', actionRef, 'resolved', 'Отопление восстановлено.')),
      process(principal, operation('event-resolved', actionRef, 'resolved', 'Отопление восстановлено.')),
    ]);
    const resolvedReplay = await process(principal, operation('event-resolved', actionRef, 'resolved', 'Отопление восстановлено.'));
    expect(resolvedReplay.duplicate).toBe(true);
    expect(resolved.recovery.status).toBe('awaiting_guest_confirmation');
    expect(resolved.recovery.outcome).toBeNull();
    expect(resolved.decision.followupRecommendation).toBe('Удалось решить проблему с отоплением. Подскажите, пожалуйста, сейчас всё в порядке?');
    expect(database.cases[0].followup_text).toBe(resolved.decision.followupRecommendation);
    const recovered = await process(principal, confirmation('event-confirmed', recovery.recoveryRef, true));
    const replay = await process(principal, confirmation('event-confirmed', recovery.recoveryRef, true));
    expect(recovered.recovery).toMatchObject({ status: 'recovered', outcome: 'satisfied', operatorRequired: false });
    expect(recovered.resultingState).toEqual({ conversation: 'resolved', issue: 'resolved', operatorRequired: false });
    expect(replay.duplicate).toBe(true);
    expect(database.events).toHaveLength(3);
    expect(database.cases).toHaveLength(1);
    expect(state.handoffs.filter((row) => row.status === 'resolved')).toHaveLength(1);
  });

  it('keeps an unsatisfied guest unrecovered and operator-required without financial or outbound effects', async () => {
    const { database, recovery, actionRef, process, state } = await setup('3');
    await process(principal, operation('unhappy-resolved', actionRef, 'resolved'));
    const result = await process(principal, confirmation('unhappy-confirmed', recovery.recoveryRef, false));
    expect(result.recovery).toMatchObject({ status: 'unrecovered', outcome: 'not_satisfied', operatorRequired: true });
    expect(result.resultingState).toEqual({ conversation: 'escalated', issue: 'blocked', operatorRequired: true });
    expect(state.handoffs.some((row) => row.reasonCode === 'guest_not_satisfied')).toBe(true);
    expect(state.actions.at(-1)?.status).toBe('blocked');
    expect(JSON.stringify({ database, state })).not.toMatch(/refund|discount|compensat|provider|outbound/i);
  });

  it('fails closed for changed replay, wrong tenant/reference, and impossible backward transitions', async () => {
    const { recovery, actionRef, process } = await setup('4');
    await process(principal, operation('conflict-event', actionRef, 'in_progress'));
    await expect(process(principal, operation('conflict-event', actionRef, 'resolved')))
      .rejects.toMatchObject({ code: 'partner_event_conflict' });
    await expect(process({ ...principal, accountId: 'other-tenant' }, operation('cross-tenant', actionRef, 'resolved')))
      .rejects.toMatchObject({ code: 'partner_recovery_scope_invalid' });
    await expect(process(principal, operation('wrong-reference', `pact_${'z'.repeat(32)}`, 'resolved')))
      .rejects.toMatchObject({ code: 'partner_recovery_scope_invalid' });
    await process(principal, operation('terminal-resolved', actionRef, 'resolved'));
    await process(principal, confirmation('terminal-confirmed', recovery.recoveryRef, true));
    await expect(process(principal, operation('backward', actionRef, 'in_progress')))
      .rejects.toBeInstanceOf(PartnerRecoveryError);
  });

  it('validates a strict discriminated union without irrelevant message fields', () => {
    expect(operation('strict-operation', `pact_${'x'.repeat(32)}`, 'requested').eventType).toBe('operation.updated');
    expect(confirmation('strict-confirmation', `prec_${'y'.repeat(32)}`, true).eventType).toBe('guest.resolution.confirmed');
    expect(() => validateTrustedPartnerRecoveryEvent({ ...eventBase('bad'), eventType: 'operation.updated',
      operation: { actionRef: `pact_${'x'.repeat(32)}`, status: 'resolved' }, guest: {} })).toThrow('partner_contract_invalid');
  });

  it('dispatches recovery variants through the existing authenticated endpoint', async () => {
    const processRecovery = vi.fn(async () => ({
      schemaVersion: 'partner.communication.response.v1' as const, accepted: true as const, duplicate: false,
      auditRef: 'pre_test', recovery: { recoveryRef: `prec_${'y'.repeat(32)}`, status: 'in_progress' as const,
        outcome: null, operatorRequired: true }, decision: { followupRecommendation: null }, operationalActions: [],
      resultingState: { conversation: 'escalated' as const, issue: 'open' as const, operatorRequired: true },
    }));
    const request = new Request('http://localhost/api/partner/v1/communication/events', {
      method: 'POST', body: JSON.stringify({ ...eventBase('endpoint-operation'), eventType: 'operation.updated',
        operation: { actionRef: `pact_${'x'.repeat(32)}`, status: 'in_progress' } }),
    });
    const response = await handlePartnerCommunicationEvent(request, {
      authenticate: async () => principal,
      process: vi.fn() as any,
      processRecovery,
    });
    expect(response.status).toBe(202);
    expect(processRecovery).toHaveBeenCalledOnce();
    expect((await response.json()).recovery.status).toBe('in_progress');
  });

  it('keeps the additive recovery migration tenant-scoped, bounded, unique, and service-role-only', () => {
    const sql = readFileSync(resolve(process.cwd(),
      'supabase/migrations/20260815190000_partner_service_recovery_loop_v1.sql'), 'utf8');
    expect(sql).toContain('partner_service_recovery_cases_source_key UNIQUE (account_id, source_decision_id)');
    expect(sql).toContain('partner_communication_actions_public_ref_key UNIQUE (public_action_ref)');
    expect(sql).toContain('partner_service_recovery_events_identity_key UNIQUE');
    expect(sql).toContain('FOREIGN KEY (account_id, session_id)');
    expect(sql).toContain('FOREIGN KEY (account_id, source_decision_id)');
    expect(sql).toContain('ALTER TABLE public.partner_service_recovery_cases FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE public.partner_service_recovery_events FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON TABLE public.partner_service_recovery_cases FROM anon, authenticated');
    expect(sql).not.toMatch(/CREATE POLICY/);
  });
});
