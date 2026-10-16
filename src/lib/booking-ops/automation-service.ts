import { requireBookingAutomationRunning, withBookingAutomationLease } from './automation-pause';
import type { BookingOpsAutomationDecision, BookingOpsRecord } from './types';
import { buildBookingOpsAutomationPatch, evaluateBookingOpsAutomation } from './decision-engine';
import { updateBookingOpsRecord } from './repository';

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

export async function runBookingOpsAutomationBatch(
  records: BookingOpsRecord[],
): Promise<BookingOpsRecord[]> {
  const evaluatedAt = new Date().toISOString();
  return Promise.all(records.map((record) => runBookingOpsAutomation(record, evaluatedAt)));
}

export function runBookingOpsAutomation(...args: Parameters<typeof runBookingOpsAutomationRunning>): ReturnType<typeof runBookingOpsAutomationRunning> {
  return withBookingAutomationLease(args[0].id, () => runBookingOpsAutomationRunning(...args));
}
