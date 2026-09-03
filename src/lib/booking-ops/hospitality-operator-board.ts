import type { CrmBookingSignal } from '@/lib/crm/booking-signals';
import type { BookingOpsAutomationState, BookingOpsRecord } from '@/lib/booking-ops/types';
import { buildBookingOpsDeepLink } from '@/lib/booking-ops/booking-ops-deep-link';

/**
 * Pilot-facing operational status for Residential ASI / Hospitality Ops.
 * Distinct from CRM lead statuses and from per-gate lifecycle rows.
 */
export const HOSPITALITY_OPERATIONAL_STATUSES = [
  'healthy_automated',
  'attention_needed',
  'blocked',
  'awaiting_owner_decision',
  'failed_intervention',
] as const;

export type HospitalityOperationalStatus = (typeof HOSPITALITY_OPERATIONAL_STATUSES)[number];

export const HOSPITALITY_OPERATIONAL_STATUS_LABELS_RU: Record<HospitalityOperationalStatus, string> = {
  healthy_automated: 'Штатно / автоматизировано',
  attention_needed: 'Нужно внимание',
  blocked: 'Заблокировано',
  awaiting_owner_decision: 'Ждёт решения владельца',
  failed_intervention: 'Сбой — нужно вмешательство',
};

export const HOSPITALITY_OPERATOR_BUCKETS = [
  'needs_attention_now',
  'at_risk',
  'asi_handled',
  'requires_owner_approval',
  'coming_next',
] as const;

export type HospitalityOperatorBucket = (typeof HOSPITALITY_OPERATOR_BUCKETS)[number];

export const HOSPITALITY_OPERATOR_BUCKET_LABELS_RU: Record<HospitalityOperatorBucket, string> = {
  needs_attention_now: 'Нужно сейчас',
  at_risk: 'Под риском',
  asi_handled: 'ASI уже ведёт',
  requires_owner_approval: 'Нужно решение владельца',
  coming_next: 'Скоро',
};

export type HospitalityOperatorBoardItem = {
  bookingOpsId: string;
  displayName: string;
  propertyLabel: string | null;
  status: HospitalityOperationalStatus;
  statusLabel: string;
  bucket: HospitalityOperatorBucket;
  bucketLabel: string;
  title: string;
  reason: string;
  nextAction: string;
  href: string;
  checkInAt: string | null;
  operatingMode: 'assisted' | 'autopilot';
};

export type HospitalityOperatorBoard = {
  generatedAt: string;
  counts: Record<HospitalityOperatorBucket, number>;
  statusCounts: Record<HospitalityOperationalStatus, number>;
  items: HospitalityOperatorBoardItem[];
  buckets: Record<HospitalityOperatorBucket, HospitalityOperatorBoardItem[]>;
};

const emptyCounts = (): Record<HospitalityOperatorBucket, number> => ({
  needs_attention_now: 0,
  at_risk: 0,
  asi_handled: 0,
  requires_owner_approval: 0,
  coming_next: 0,
});

const emptyStatusCounts = (): Record<HospitalityOperationalStatus, number> => ({
  healthy_automated: 0,
  attention_needed: 0,
  blocked: 0,
  awaiting_owner_decision: 0,
  failed_intervention: 0,
});

function hoursUntil(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return (ms - nowMs) / (60 * 60 * 1000);
}

function automationStateOf(record: BookingOpsRecord): BookingOpsAutomationState | null {
  return record.automation?.automationState ?? null;
}

export function resolveHospitalityOperationalStatus(
  record: BookingOpsRecord,
  signal: CrmBookingSignal | null,
): HospitalityOperationalStatus {
  const state = automationStateOf(record);

  if (record.isBlocked || state === 'blocked' || signal?.kind === 'incident_blocker' || signal?.kind === 'closure_blocked') {
    if (state === 'blocked' || record.isBlocked) return 'blocked';
    if (signal?.severity === 'critical') return 'failed_intervention';
    return 'blocked';
  }

  if (
    state === 'manual_override'
    || record.automation?.needsOperatorAction === true
    || signal?.kind === 'intake_needs_review'
  ) {
    // Owner/operator gated steps surface as awaiting decision when approval language is present.
    const needsApproval =
      state === 'manual_override'
      || /согласован|подтверд|одобр|владел/i.test(`${signal?.nextAction ?? ''} ${signal?.title ?? ''}`);
    if (needsApproval && state === 'manual_override') return 'awaiting_owner_decision';
    return 'attention_needed';
  }

  if (state === 'needs_operator_attention' || signal?.severity === 'critical' || signal?.severity === 'warning') {
    return 'attention_needed';
  }

  if (state === 'automatic_action_available' || state === 'waiting' || state === 'completed' || state === 'paused') {
    return 'healthy_automated';
  }

  if (state === 'action_required') return 'attention_needed';

  if (!signal) return 'healthy_automated';
  return signal.severity === 'info' ? 'healthy_automated' : 'attention_needed';
}

export function resolveHospitalityOperatorBucket(
  record: BookingOpsRecord,
  signal: CrmBookingSignal | null,
  status: HospitalityOperationalStatus,
  nowMs: number,
): HospitalityOperatorBucket {
  const state = automationStateOf(record);

  if (status === 'awaiting_owner_decision' || state === 'manual_override') {
    return 'requires_owner_approval';
  }

  if (status === 'blocked' || status === 'failed_intervention') {
    return 'needs_attention_now';
  }

  if (state === 'automatic_action_available' || (state === 'waiting' && !signal)) {
    return 'asi_handled';
  }

  if (signal?.severity === 'critical' || status === 'attention_needed') {
    const hours = hoursUntil(record.checkInAt, nowMs);
    if (hours !== null && hours > 0 && hours <= 48 && signal?.kind === 'checkin_blocked') {
      return 'at_risk';
    }
    if (signal && signal.priority <= 3) return 'needs_attention_now';
    if (status === 'attention_needed' && signal) return 'needs_attention_now';
  }

  const hours = hoursUntil(record.checkInAt, nowMs);
  if (hours !== null && hours >= 0 && hours <= 72) {
    if (signal?.kind === 'checkin_blocked' || signal?.kind === 'documents_incomplete') {
      return 'at_risk';
    }
    return 'coming_next';
  }

  if (state === 'waiting' || !signal) {
    return 'asi_handled';
  }

  if (signal.severity === 'info' || signal.kind === 'recent_booking') {
    return 'coming_next';
  }

  return 'needs_attention_now';
}

function displayNameFor(record: BookingOpsRecord, signal: CrmBookingSignal | null): string {
  if (signal?.displayName?.trim()) return signal.displayName.trim();
  if (record.guestName?.trim()) return record.guestName.trim();
  if (record.propertyLabel?.trim()) return record.propertyLabel.trim();
  return `Бронь ${record.bookingId?.trim() || record.id.slice(0, 8)}`;
}

function operatingModeFor(record: BookingOpsRecord): 'assisted' | 'autopilot' {
  const state = automationStateOf(record);
  if (state === 'automatic_action_available' || (state === 'waiting' && record.automation?.canAutoPerform)) {
    return 'autopilot';
  }
  return 'assisted';
}

export function buildHospitalityOperatorBoardItem(
  record: BookingOpsRecord,
  signal: CrmBookingSignal | null,
  nowIso = new Date().toISOString(),
): HospitalityOperatorBoardItem {
  const nowMs = new Date(nowIso).getTime();
  const status = resolveHospitalityOperationalStatus(record, signal);
  const bucket = resolveHospitalityOperatorBucket(record, signal, status, nowMs);
  const title =
    signal?.title
    ?? (status === 'healthy_automated' ? 'Бронь без срочных исключений' : HOSPITALITY_OPERATIONAL_STATUS_LABELS_RU[status]);
  const reason =
    signal?.reason
    ?? record.blockerReason
    ?? record.automation?.reason
    ?? 'Следующий шаг виден в Booking Ops.';
  const nextAction =
    signal?.nextAction
    ?? (record.automation?.nextAction
      ? String(record.automation.nextAction)
      : 'Открыть бронь в Booking Ops');

  return {
    bookingOpsId: record.id,
    displayName: displayNameFor(record, signal),
    propertyLabel: record.propertyLabel,
    status,
    statusLabel: HOSPITALITY_OPERATIONAL_STATUS_LABELS_RU[status],
    bucket,
    bucketLabel: HOSPITALITY_OPERATOR_BUCKET_LABELS_RU[bucket],
    title,
    reason,
    nextAction,
    href: signal?.bookingOpsHref || buildBookingOpsDeepLink(record.id),
    checkInAt: record.checkInAt,
    operatingMode: operatingModeFor(record),
  };
}

export function buildHospitalityOperatorBoard(
  records: BookingOpsRecord[],
  signals: CrmBookingSignal[] = [],
  nowIso = new Date().toISOString(),
): HospitalityOperatorBoard {
  const signalById = new Map(signals.map((signal) => [signal.bookingOpsId, signal]));
  const items = records
    .map((record) => buildHospitalityOperatorBoardItem(record, signalById.get(record.id) ?? null, nowIso))
    .sort((a, b) => {
      const bucketRank = HOSPITALITY_OPERATOR_BUCKETS.indexOf(a.bucket) - HOSPITALITY_OPERATOR_BUCKETS.indexOf(b.bucket);
      if (bucketRank !== 0) return bucketRank;
      const aTime = new Date(a.checkInAt ?? 0).getTime();
      const bTime = new Date(b.checkInAt ?? 0).getTime();
      return aTime - bTime;
    });

  const buckets = {
    needs_attention_now: items.filter((item) => item.bucket === 'needs_attention_now'),
    at_risk: items.filter((item) => item.bucket === 'at_risk'),
    asi_handled: items.filter((item) => item.bucket === 'asi_handled'),
    requires_owner_approval: items.filter((item) => item.bucket === 'requires_owner_approval'),
    coming_next: items.filter((item) => item.bucket === 'coming_next'),
  } satisfies Record<HospitalityOperatorBucket, HospitalityOperatorBoardItem[]>;

  const counts = emptyCounts();
  for (const bucket of HOSPITALITY_OPERATOR_BUCKETS) {
    counts[bucket] = buckets[bucket].length;
  }

  const statusCounts = emptyStatusCounts();
  for (const item of items) {
    statusCounts[item.status] += 1;
  }

  return {
    generatedAt: nowIso,
    counts,
    statusCounts,
    items,
    buckets,
  };
}
