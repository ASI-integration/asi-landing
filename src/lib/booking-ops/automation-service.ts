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

export async function runBookingOpsAutomation(
  record: BookingOpsRecord,
  evaluatedAt = new Date().toISOString(),
): Promise<BookingOpsRecord> {
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
    const result = await updateBookingOpsRecord(record.id, patch);
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
    return withDecision(record, {
      ...decision,
      automationState: 'needs_operator_attention',
      needsOperatorAction: true,
      canAutoPerform: false,
      recommendedOpsStatus: null,
      reason: 'Автоматический шаг не сохранён; оператору нужно проверить бронь.',
    });
  }
}

export async function runBookingOpsAutomationBatch(
  records: BookingOpsRecord[],
): Promise<BookingOpsRecord[]> {
  const evaluatedAt = new Date().toISOString();
  return Promise.all(records.map((record) => runBookingOpsAutomation(record, evaluatedAt)));
}
