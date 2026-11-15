import { requireBookingAutomationRunning, withBookingAutomationLease } from './automation-pause';
import type { BookingOpsAutomationDecision, BookingOpsRecord } from './types';
import { buildBookingOpsAutomationPatch, evaluateBookingOpsAutomation } from './decision-engine';
import { updateBookingOpsRecord } from './repository';

export type BookingOpsAutomationRequest = {
  requestId: string;
  accountId: string;
  propertyId: string;
};

export type BookingOpsAutomationRequestIntakeResult = {
  sourceOnly: true;
} & (
  | { accepted: true; request: BookingOpsAutomationRequest }
  | { accepted: false; code: 'invalid_request' | 'scope_mismatch' | 'duplicate_unacknowledged' }
);

/** Validation only: acceptance does not create a booking, CRM work or an execution lease.
 * The caller supplies the authorized operator scope and its snapshot of prior work.
 * This source-only check is not durable deduplication or permission to execute.
 */
export function intakeBookingOpsAutomationRequest(
  request: BookingOpsAutomationRequest,
  operatorScope: { accountId: string; propertyId: string },
  existingWork: ReadonlyArray<BookingOpsAutomationRequest & { acknowledged: boolean }>,
): BookingOpsAutomationRequestIntakeResult {
  const normalized = {
    requestId: request.requestId.trim(),
    accountId: request.accountId.trim(),
    propertyId: request.propertyId.trim(),
  };
  if (!normalized.requestId || !normalized.accountId || !normalized.propertyId
    || normalized.accountId === 'legacy') {
    return { sourceOnly: true, accepted: false, code: 'invalid_request' };
  }
  if (normalized.accountId !== operatorScope.accountId.trim()
    || normalized.propertyId !== operatorScope.propertyId.trim()) {
    return { sourceOnly: true, accepted: false, code: 'scope_mismatch' };
  }
  if (existingWork.some((work) => work.accountId.trim() === normalized.accountId
    && work.propertyId.trim() === normalized.propertyId
    && work.requestId.trim() === normalized.requestId
    && work.acknowledged !== true)) {
    return { sourceOnly: true, accepted: false, code: 'duplicate_unacknowledged' };
  }
  return { sourceOnly: true, accepted: true, request: normalized };
}

function withDecision(
  record: BookingOpsRecord,
  decision: BookingOpsAutomationDecision,
): BookingOpsRecord {
  return { ...record, automation: decision };
}

export function attachBookingOpsAutomation(
  record: BookingOpsRecord,
  evaluatedAt = new Date().toISOString(),
): BookingOpsRecord {
  return withDecision(record, evaluateBookingOpsAutomation(record, evaluatedAt));
}

async function runBookingOpsAutomationRunning(
  record: BookingOpsRecord,
  evaluatedAt = new Date().toISOString(),
): Promise<BookingOpsRecord> {
  await requireBookingAutomationRunning(record.id);
  const decision = evaluateBookingOpsAutomation(record, evaluatedAt);
  const patch = buildBookingOpsAutomationPatch(record, evaluatedAt);

  console.info('[booking-ops-automation] decision', {
    recordId: record.id,
    previousOpsStatus: record.opsStatus,
    recommendedOpsStatus: decision.recommendedOpsStatus,
    nextAction: decision.nextAction,
    automationState: decision.automationState,
    canAutoPerform: decision.canAutoPerform,
    needsOperatorAction: decision.needsOperatorAction,
    blockers: decision.blockers,
    timestamp: evaluatedAt,
    reason: decision.reason,
  });

  if (Object.keys(patch).length === 0) return withDecision(record, decision);

  try {
    const accountId = String(record.accountId ?? '').trim();
    const propertyId = String(record.propertyId ?? '').trim();
    const expectedScope = accountId && accountId !== 'legacy' && propertyId
      ? { accountId, propertyId }
      : undefined;
    const result = await updateBookingOpsRecord(
      record.id,
      patch,
      expectedScope ? { actorType: 'system', expectedScope } : { actorType: 'system' },
    );
    if (!result.ok || !result.record) {
      throw new Error(result.error || 'update_failed');
    }
    return attachBookingOpsAutomation(result.record, evaluatedAt);
  } catch (error) {
    console.error('[booking-ops-automation] automatic update failed', {
      recordId: record.id,
      previousOpsStatus: record.opsStatus,
      nextAction: decision.nextAction,
      timestamp: evaluatedAt,
      error,
    });
    // A failed acknowledgement cannot prove the remote write stopped. Retain the lease.
    throw error;
  }
}

export type BookingOpsAutomationBatchResult = {
  records: BookingOpsRecord[];
  failures: Array<{ recordId: string; code: 'manual_reconciliation_required' }>;
};

export async function runBookingOpsAutomationBatch(
  records: BookingOpsRecord[],
): Promise<BookingOpsAutomationBatchResult> {
  const evaluatedAt = new Date().toISOString();
  const outcomes = await Promise.allSettled(
    records.map((record) => runBookingOpsAutomation(record, evaluatedAt)),
  );
  const result: BookingOpsAutomationBatchResult = { records: [], failures: [] };
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') result.records.push(outcome.value);
    else result.failures.push({ recordId: records[index].id, code: 'manual_reconciliation_required' });
  });
  return result;
}

export function runBookingOpsAutomation(...args: Parameters<typeof runBookingOpsAutomationRunning>): ReturnType<typeof runBookingOpsAutomationRunning> {
  return withBookingAutomationLease(args[0].id, () => runBookingOpsAutomationRunning(...args));
}
