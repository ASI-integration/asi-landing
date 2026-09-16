import type { PaymentStatus } from './types';

/** Terminal success cannot be downgraded by stale provider events. */
const TERMINAL_SUCCESS: ReadonlySet<PaymentStatus> = new Set(['paid', 'refunded', 'partially_refunded']);

const ALLOWED_TRANSITIONS: Record<PaymentStatus, ReadonlySet<PaymentStatus>> = {
  pending: new Set(['requires_action', 'paid', 'failed', 'cancelled', 'expired']),
  requires_action: new Set(['pending', 'paid', 'failed', 'cancelled', 'expired']),
  paid: new Set(['refunded', 'partially_refunded']),
  failed: new Set(['pending', 'paid']), // rare provider recovery — still no cancel-after-fail overwrite of paid
  cancelled: new Set(['pending', 'paid']),
  expired: new Set(['pending', 'paid']),
  refunded: new Set(),
  partially_refunded: new Set(['refunded']),
};

export function canTransitionPaymentStatus(
  current: PaymentStatus,
  next: PaymentStatus,
): boolean {
  if (current === next) return true;
  if (TERMINAL_SUCCESS.has(current) && next !== 'refunded' && next !== 'partially_refunded') {
    return false;
  }
  return ALLOWED_TRANSITIONS[current]?.has(next) ?? false;
}
