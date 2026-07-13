import { supabase } from '@/lib/supabase';
import { acknowledgeOperatorAlert, getOperatorAlert, resolveOperatorAlertOccurrence } from './operator-alerts';
import { runBookingOpsAutomationForBooking } from './booking-automation-runner';
import { markIntentAutoSendEligible } from './communication-auto-send-policy';
import { approveFinalPhysicalReadiness, updateCleaningTask } from './physical-readiness-execution';

export const OPERATOR_EXCEPTION_ACTIONS = [
  'acknowledge', 'retry_automation', 'approve_prepared_communication', 'assign_cleaner',
  'approve_property_readiness', 'resolve_alert', 'open_booking',
] as const;
export type OperatorExceptionAction = (typeof OPERATOR_EXCEPTION_ACTIONS)[number];

const text = (value: unknown) => String(value ?? '').trim();

export async function applyOperatorExceptionAction(input: {
  accountId: string; alertId: string; action: OperatorExceptionAction; actor: string;
  reason?: unknown; assignedToName?: unknown; assignedToPhone?: unknown; assignedToTelegram?: unknown;
}) {
  const alert = await getOperatorAlert(input.accountId, input.alertId);
  if (!alert) throw new Error('alert_not_found');
  switch (input.action) {
    case 'acknowledge': return { alert: await acknowledgeOperatorAlert(input.accountId, input.alertId, input.actor) };
    case 'retry_automation': {
      const automation = await runBookingOpsAutomationForBooking({ bookingId: alert.bookingId, expectedAccountId: input.accountId });
      const refreshed = await getOperatorAlert(input.accountId, input.alertId);
      return { alert: refreshed, automation };
    }
    case 'approve_prepared_communication': {
      const communicationId = text(alert.metadata.referenceId);
      if (!communicationId) throw new Error('prepared_communication_missing');
      const owned = await supabase.from('booking_ops_communication_intents').select('id').eq('id', communicationId).eq('booking_ops_record_id', alert.bookingId).maybeSingle();
      if (owned.error) throw new Error(owned.error.message);
      if (!owned.data) throw new Error('prepared_communication_missing');
      const result = await markIntentAutoSendEligible(communicationId, 'Разрешено оператором после проверки.', { operator_action: 'approve_prepared_communication' });
      if (!result.ok) throw new Error(result.error ?? 'communication_approval_failed');
      return { alert, approvedForQueue: true, actuallySent: false };
    }
    case 'assign_cleaner': {
      const assignedToName = text(input.assignedToName);
      const assignedToPhone = text(input.assignedToPhone);
      const assignedToTelegram = text(input.assignedToTelegram);
      if (!assignedToName && !assignedToPhone && !assignedToTelegram) throw new Error('cleaning_executor_required');
      const readiness = await updateCleaningTask(alert.bookingId, { status: 'assigned', assignedToName, assignedToPhone, assignedToTelegram });
      return { alert, readiness };
    }
    case 'approve_property_readiness': return { alert, readiness: await approveFinalPhysicalReadiness(alert.bookingId, input.actor) };
    case 'resolve_alert': return { alert: await resolveOperatorAlertOccurrence(input.accountId, input.alertId, input.actor, text(input.reason)), canRecur: true };
    case 'open_booking': return { alert, bookingId: alert.bookingId };
  }
}
