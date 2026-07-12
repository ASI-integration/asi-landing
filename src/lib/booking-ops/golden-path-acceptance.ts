import { supabase } from '@/lib/supabase';
import { durableEventId, getBookingLifecycleSummary, recordAndProcessBookingEvent } from './lifecycle-autopilot-service';
import { getBookingOpsRecord } from './repository';
import { listBookingOpsTasksForRecord } from './tasks';
import { syncBookingOpsCommunications } from './communication-orchestrator';

const SOURCE = 'ops_v17_2_golden_path_acceptance';
const EVENT_TYPES = [
  'booking.received', 'guest.contacted', 'guest.data_requested', 'guest.data_submitted',
  'guest.documents_received', 'documents.verified', 'contract.generated', 'deposit.confirmed',
  'mvd.not_required', 'cleaner.task_completed', 'linen.task_completed',
  'consumables.task_completed', 'inspection.completed', 'property.ready',
  'checkin.instructions_released', 'guest.checked_in', 'stay.started', 'checkout.started',
  'checkout.inspection_completed', 'deposit.return_completed', 'booking.closed',
] as const;

export type GoldenPathStep = { key: string; eventType: string; status: 'PASS' | 'FAIL' | 'PLANNED'; detail: string };
export type GoldenPathReport = {
  reservationReference: string; accountScopeVerified: true; dryRun: boolean;
  initialStatus: string; initialLifecycleStage: string | null; finalReservationStatus: string;
  finalLifecycleStage: string | null; domainEvents: number;
  workerTasks: Record<string, Record<string, number>>; readinessResult: string | null;
  persistedLifecycle: { currentStage: string | null; status: string | null; blockers: string[]; propertyId: string | null };
  blockers: string[]; communicationIntents: number; communicationDrafts: number;
  realMessagesSent: number; externalCalls: 0; processingErrors: Array<{ type: string; error: string }>;
  idempotency: { deterministicEventIds: true; duplicateEvents: number; changed: boolean };
  messagingDisabled: true; otaCallsDisabled: true; paymentCallsDisabled: true;
  missingPrerequisites: string[]; proposedEvents: string[]; proposedWorkerTasks: string[];
  readinessGatesThatWouldChange: string[]; communicationDraftsThatWouldBePrepared: string[];
  steps: GoldenPathStep[]; overall: 'PASS' | 'FAIL' | 'PLANNED';
};

type ReservationRow = { id: string; booking_id: string | null; account_id: string | null; asi_reference: string | null; normalized_status: string; property_id: string | null; reservation_metadata: Record<string, unknown> | null };

function isAcceptanceSafe(metadata: Record<string, unknown> | null): boolean {
  return metadata?.acceptance_safe === true || metadata?.test_reservation === true || metadata?.environment === 'test';
}

async function loadReservation(identifier: string, accountId: string): Promise<ReservationRow> {
  const lookup = supabase.from('booking_ops_records').select('id,booking_id,account_id,asi_reference,normalized_status,property_id,reservation_metadata');
  const result = await (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(identifier) ? lookup.eq('id', identifier) : lookup.eq('asi_reference', identifier)).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error('reservation_not_found');
  const row = result.data as ReservationRow;
  if (!row.account_id) throw new Error('reservation_account_not_found');
  if (row.account_id !== accountId) throw new Error('reservation_account_mismatch');
  return row;
}

async function taskCounts(bookingId: string) {
  const result = await supabase.from('booking_ops_worker_tasks').select('assigned_role,status').eq('booking_id', bookingId);
  if (result.error) throw new Error(result.error.message);
  const counts: Record<string, Record<string, number>> = {};
  for (const row of result.data ?? []) {
    const role = String(row.assigned_role); const status = String(row.status);
    counts[role] ??= {}; counts[role][status] = (counts[role][status] ?? 0) + 1;
  }
  return counts;
}

async function persistedLifecycle(bookingId: string) {
  const result = await supabase.from('booking_ops_lifecycle_states').select('current_stage,status,blocker_reasons,property_id').eq('booking_id', bookingId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return { currentStage: result.data?.current_stage ?? null, status: result.data?.status ?? null, blockers: (result.data?.blocker_reasons ?? []) as string[], propertyId: result.data?.property_id ?? null };
}

function requiredTasksCompleted(tasks: Record<string, Record<string, number>>) {
  return ['cleaner', 'linen_worker', 'consumables', 'inspector'].every((role) => (tasks[role]?.completed ?? 0) > 0 && Object.entries(tasks[role] ?? {}).every(([status, count]) => status === 'completed' || count === 0));
}

async function communicationCounts(recordId: string, sourceBookingId: string | null) {
  const [intents, drafts, deliveries] = await Promise.all([
    supabase.from('booking_ops_communication_intents').select('id', { count: 'exact', head: true }).eq('booking_ops_record_id', recordId),
    supabase.from('booking_ops_lifecycle_drafts').select('id', { count: 'exact', head: true }).eq('booking_id', recordId),
    supabase.from('booking_ops_communication_deliveries').select('id', { count: 'exact', head: true }).eq('booking_id', sourceBookingId ?? recordId).eq('status', 'sent'),
  ]);
  for (const result of [intents, drafts, deliveries]) if (result.error && result.error.code !== '42P01') throw new Error(result.error.message);
  return { intents: intents.count ?? 0, drafts: drafts.count ?? 0, realSends: deliveries.count ?? 0 };
}

function plan(row: ReservationRow, stage: string | null, missing: string[]): GoldenPathReport {
  return {
    reservationReference: row.asi_reference ?? row.id, accountScopeVerified: true, dryRun: true,
    initialStatus: row.normalized_status, initialLifecycleStage: stage, finalReservationStatus: row.normalized_status,
    finalLifecycleStage: stage, domainEvents: 0, workerTasks: {}, readinessResult: null, persistedLifecycle: { currentStage: null, status: null, blockers: [], propertyId: row.property_id }, blockers: missing,
    communicationIntents: 0, communicationDrafts: 0, realMessagesSent: 0, externalCalls: 0, processingErrors: [],
    idempotency: { deterministicEventIds: true, duplicateEvents: 0, changed: false },
    messagingDisabled: true, otaCallsDisabled: true, paymentCallsDisabled: true,
    missingPrerequisites: missing, proposedEvents: [...EVENT_TYPES],
    proposedWorkerTasks: ['cleaner', 'linen_worker', 'consumables', 'inspector'],
    readinessGatesThatWouldChange: ['legal', 'physical_readiness', 'checkin_release', 'checkout', 'closure'],
    communicationDraftsThatWouldBePrepared: ['guest data request', 'document request', 'contract', 'deposit request', 'check-in instructions'],
    steps: EVENT_TYPES.map((eventType) => ({ key: eventType, eventType, status: 'PLANNED', detail: 'Deterministic internal event; no external call.' })),
    overall: 'PLANNED',
  };
}

export async function runGoldenPathAcceptance(input: { identifier: string; accountId: string; actorId: string; dryRun?: boolean; confirm?: boolean; featureEnabled?: boolean }): Promise<GoldenPathReport> {
  const row = await loadReservation(input.identifier, input.accountId);
  const before = await getBookingLifecycleSummary(row.id);
  const hardMissing = [!row.property_id ? 'property' : null, !isAcceptanceSafe(row.reservation_metadata) ? 'acceptance_safe_marker' : null].filter((x): x is string => Boolean(x));
  const missing = [...new Set([...before.blockers, ...hardMissing])];
  if (input.dryRun !== false) return plan(row, before.stage, missing);
  if (input.confirm !== true) throw new Error('explicit_confirmation_required');
  if (!input.featureEnabled) throw new Error('golden_path_feature_disabled');
  if (hardMissing.length > 0) throw new Error(`golden_path_prerequisites_missing:${hardMissing.join(',')}`);

  const steps: GoldenPathStep[] = [];
  let duplicateEvents = 0;
  const correlationId = durableEventId(SOURCE, row.id);
  if (row.normalized_status === 'inquiry' || row.normalized_status === 'temporary_hold') {
    const updated = await supabase.from('booking_ops_records').update({ normalized_status: 'confirmed', updated_at: new Date().toISOString() }).eq('id', row.id).eq('account_id', input.accountId);
    if (updated.error) throw new Error(updated.error.message);
  }
  for (const [index, eventType] of EVENT_TYPES.entries()) {
    try {
      const outcome = await recordAndProcessBookingEvent({ id: durableEventId(SOURCE, row.id, eventType), bookingId: row.id, objectId: row.property_id, type: eventType, actorType: 'system', actorId: input.actorId, source: SOURCE, correlationId, payload: { acceptance: true, step: index + 1, actual_send_enabled: false } });
      if (outcome.duplicate) duplicateEvents += 1;
      steps.push({ key: eventType, eventType, status: 'PASS', detail: outcome.duplicate ? 'Already applied; no change.' : 'Applied through OPS v16 lifecycle service.' });
    } catch (error) {
      steps.push({ key: eventType, eventType, status: 'FAIL', detail: error instanceof Error ? error.message : 'step_failed' });
      break;
    }
  }
  if (steps.every((step) => step.status === 'PASS')) {
    try {
      const [record, tasksResult] = await Promise.all([getBookingOpsRecord(row.id), listBookingOpsTasksForRecord(row.id)]);
      if (!record) throw new Error('booking_context_not_found');
      if (!tasksResult.ok) throw new Error(tasksResult.error);
      const synced = await syncBookingOpsCommunications({ record, tasks: tasksResult.tasks });
      if (!synced.ok) throw new Error(synced.error ?? 'communication_draft_sync_failed');
      steps.push({ key: 'communication.drafts', eventType: 'communication.drafts', status: 'PASS', detail: 'Safe internal drafts synchronized; no delivery executor called.' });
    } catch (error) {
      steps.push({ key: 'communication.drafts', eventType: 'communication.drafts', status: 'FAIL', detail: error instanceof Error ? error.message : 'communication_draft_sync_failed' });
    }
  }
  const after = await getBookingLifecycleSummary(row.id);
  const communications = await communicationCounts(row.id, row.booking_id);
  const [tasks, persisted] = await Promise.all([taskCounts(row.id), persistedLifecycle(row.id)]);
  const convergenceFailures = [
    after.stage !== 'closed' ? 'canonical_lifecycle_not_closed' : null,
    persisted.currentStage !== 'closed' ? 'persisted_lifecycle_not_closed' : null,
    persisted.blockers.length ? `persisted_blockers:${persisted.blockers.join(',')}` : null,
    persisted.propertyId !== row.property_id ? 'persisted_property_mismatch' : null,
    after.readiness !== 'ready' || after.blockers.length ? 'readiness_not_closed' : null,
    !requiredTasksCompleted(tasks) ? 'required_worker_tasks_incomplete' : null,
  ].filter((value): value is string => Boolean(value));
  const converged = convergenceFailures.length === 0 && after.processingErrors.length === 0 && communications.realSends === 0 && steps.every((step) => step.status === 'PASS');
  if (converged) {
    const updated = await supabase.from('booking_ops_records').update({ normalized_status: 'checked_out', updated_at: new Date().toISOString() }).eq('id', row.id).eq('account_id', input.accountId);
    if (updated.error) throw new Error(updated.error.message);
  }
  return {
    ...plan(row, before.stage, missing), dryRun: false, finalReservationStatus: converged ? 'checked_out' : row.normalized_status,
    finalLifecycleStage: after.stage, domainEvents: after.domainEventCount, workerTasks: tasks,
    readinessResult: after.readiness, persistedLifecycle: persisted, blockers: [...after.blockers, ...convergenceFailures], communicationIntents: communications.intents,
    communicationDrafts: communications.drafts, processingErrors: after.processingErrors.map((x) => ({ type: x.type, error: String(x.error) })),
    realMessagesSent: communications.realSends,
    idempotency: { deterministicEventIds: true, duplicateEvents, changed: duplicateEvents !== EVENT_TYPES.length },
    steps, overall: converged ? 'PASS' : 'FAIL', missingPrerequisites: [...after.blockers, ...convergenceFailures],
  };
}
