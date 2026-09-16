/**
 * Bounded entitlement activation after authoritative payment confirmation.
 * Idempotent and auditable; does not invent permanent commercial plan schemas.
 */
import { claimPaymentConfirmation } from './events';
import type { PaymentRequest } from './types';

export type EntitlementActivationResult = {
  activated: boolean;
  alreadyActive: boolean;
  paymentId: string;
  productId: string | null;
  ownerKey: string | null;
};

const activatedEntitlements = new Map<string, EntitlementActivationResult>();

function entitlementKey(payment: PaymentRequest): string {
  return `entitlement:${payment.id}`;
}

/**
 * Marks a paid purchase as entitled exactly once.
 * Future subscription/plan wiring plugs in here without rewriting payment core.
 */
export async function activateEntitlementForPaidPayment(
  payment: PaymentRequest,
): Promise<EntitlementActivationResult> {
  const productId = payment.serviceType ?? null;
  const ownerKey = payment.guestId ?? payment.chatId ?? payment.propertyId ?? null;
  const key = entitlementKey(payment);

  if (activatedEntitlements.has(key)) {
    return {
      activated: false,
      alreadyActive: true,
      paymentId: payment.id,
      productId,
      ownerKey,
    };
  }

  const claimed = await claimPaymentConfirmation(key);
  if (!claimed) {
    return {
      activated: false,
      alreadyActive: true,
      paymentId: payment.id,
      productId,
      ownerKey,
    };
  }

  const result: EntitlementActivationResult = {
    activated: true,
    alreadyActive: false,
    paymentId: payment.id,
    productId,
    ownerKey,
  };
  activatedEntitlements.set(key, result);

  // Bounded audit log — no secrets, no full provider payloads.
  console.info(
    `[payments/entitlement] activated paymentId=${payment.id} product=${productId ?? 'unknown'} amount=${payment.amount} ${payment.currency}`,
  );

  return result;
}

/** Test helper */
export function _resetEntitlements(): void {
  activatedEntitlements.clear();
}
