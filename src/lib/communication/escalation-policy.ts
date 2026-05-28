import type { ClassifyResult, IdentityResolution } from './types';
import { EscalationReason, MessageCategory } from './types';

export type EscalationDecision =
  | { escalate: false; reason?: never; detail?: never; confidence?: number }
  | { escalate: true; reason: EscalationReason; detail: string; confidence?: number };

export type EscalationConfig = {
  /** Minimum acceptable confidence for autonomous routing/handling. */
  minConfidence: number;
};

export function getEscalationConfig(): EscalationConfig {
  return {
    minConfidence: Number(process.env.COMM_ESCALATE_CONFIDENCE_THRESHOLD ?? 0.6),
  };
}

function includesAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some(n => h.includes(n));
}

export function detectComplaintOrAnger(text: string): boolean {
  return includesAny(text, [
    'angry',
    'furious',
    'upset',
    'mad',
    'terrible',
    'worst',
    'scam',
    'fraud',
    'unacceptable',
    'complaint',
    'disgusting',
    'refund now',
    'chargeback',
    'lawyer',
    'police',
    'жалоб',
    'возмущен',
    'ужас',
    'обман',
    'мошен',
    'неприемлемо',
    'верните деньги',
    'полици',
    'прокурат',
    'суд',
  ]);
}

export function detectPaymentIssue(text: string): boolean {
  return includesAny(text, [
    'refund',
    'invoice dispute',
    'dispute',
    'chargeback',
    'payment failed',
    'failed payment',
    'card declined',
    'declined',
    'charged twice',
    'double charged',
    'оплата не прошла',
    'платеж не прошел',
    'списали',
    'списание',
    'возврат',
    'чарджбек',
    'оспорить',
  ]);
}

export function detectSafetyRisk(text: string): boolean {
  const t = text.toLowerCase();
  // Avoid false positives in internal/dev phrases.
  if (t.includes('smoke test')) return false;
  return includesAny(text, [
    'fire',
    'smoke',
    'gas',
    'leak',
    'flood',
    'injury',
    'accident',
    'threat',
    'unsafe',
    'danger',
    'emergency',
    'пожар',
    'дым',
    'газ',
    'утечк',
    'затоп',
    'травм',
    'угроза',
    'опасно',
    'экстр',
  ]);
}

export function shouldEscalateByRules(params: {
  text: string;
  classification: ClassifyResult;
  confidence?: number;
  identity?: IdentityResolution;
  reservationResolutionStatus?: 'matched' | 'ambiguous' | 'unmatched';
  intent?: string | null;
}): EscalationDecision {
  const cfg = getEscalationConfig();
  const conf = typeof params.confidence === 'number' ? params.confidence : undefined;
  const category = params.classification?.category as any;
  const operationalCategories = new Set<string>([
    MessageCategory.GuestMessage,
    MessageCategory.Issue,
    MessageCategory.Booking,
    MessageCategory.Fallback,
  ]);

  if (typeof conf === 'number' && conf < cfg.minConfidence) {
    return {
      escalate: true,
      reason: EscalationReason.LowIntentConfidence,
      confidence: conf,
      detail: `low_confidence:${conf.toFixed(3)}<${cfg.minConfidence}`,
    };
  }

  if (detectSafetyRisk(params.text)) {
    return {
      escalate: true,
      reason: EscalationReason.UrgentIssue,
      confidence: conf,
      detail: 'safety_risk_detected',
    };
  }

  if (detectPaymentIssue(params.text)) {
    return {
      escalate: true,
      reason: EscalationReason.PaymentComplaint,
      confidence: conf,
      detail: 'payment_issue_detected',
    };
  }

  if (detectComplaintOrAnger(params.text)) {
    return {
      escalate: true,
      reason: EscalationReason.RequiresOperator,
      confidence: conf,
      detail: 'complaint_or_anger_detected',
    };
  }

  const isSafeSelfServiceIntent = [
    'checkin_code_request',
    'booking_lookup_missing_details',
    'cleaning_issue',
    'maintenance_issue',
  ].includes(String(params.intent ?? ''));

  // Identity / reservation ambiguity that remained unresolved.
  // Safe non-urgent self-service replies can collect context or register ops first;
  // they must not imply verified booking/code data until a later lookup succeeds.
  if (
    !isSafeSelfServiceIntent &&
    operationalCategories.has(String(category)) &&
    params.identity?.status &&
    params.identity.status !== 'resolved'
  ) {
    return {
      escalate: true,
      reason: EscalationReason.RequiresOperator,
      confidence: conf,
      detail: `identity_ambiguous:${params.identity.status}`,
    };
  }

  if (
    !isSafeSelfServiceIntent &&
    operationalCategories.has(String(category)) &&
    params.reservationResolutionStatus &&
    params.reservationResolutionStatus !== 'matched'
  ) {
    return {
      escalate: true,
      reason: EscalationReason.RequiresOperator,
      confidence: conf,
      detail: `reservation_ambiguous:${params.reservationResolutionStatus}`,
    };
  }

  return { escalate: false };
}

