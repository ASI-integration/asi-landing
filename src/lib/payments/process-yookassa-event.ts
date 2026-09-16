/**
 * Authoritative YooKassa payment event processing.
 * Always prefers provider GET /payments/{id} over webhook payload trust.
 */
import { activateEntitlementForPaidPayment } from './entitlement';
import { claimWebhookEvent, releaseWebhookEvent } from './events';
import { getPaymentById, getPaymentByTransactionId, updatePaymentRecord } from './db';
import { getYooKassaConfig } from './yookassa-env';
import { getYooKassaHttp } from './yookassa-http';
import { canTransitionPaymentStatus } from './status-machine';
import type { PaymentRequest, PaymentStatus } from './types';

export type ProviderPaymentSnapshot = {
  id: string;
  status: string;
  amount: { value: string; currency: string };
  metadata?: Record<string, string>;
  paid?: boolean;
};

function mapProviderStatus(status: string): PaymentStatus {
  switch (status) {
    case 'succeeded':
      return 'paid';
    case 'canceled':
      return 'cancelled';
    case 'waiting_for_capture':
    case 'pending':
      return 'pending';
    default:
      return 'pending';
  }
}

function amountMinorFromProvider(value: string): number {
  return Math.round(parseFloat(value) * 100);
}

export async function fetchAuthoritativeYooKassaPayment(
  providerPaymentId: string,
): Promise<ProviderPaymentSnapshot> {
  const config = getYooKassaConfig();
  if (!config) {
    throw new Error('YooKassa config missing');
  }
  const http = getYooKassaHttp();
  const response = await http({
    method: 'GET',
    path: `/payments/${encodeURIComponent(providerPaymentId)}`,
    shopId: config.shopId,
    secretKey: config.secretKey,
  });
  if (!response.ok || !response.json || typeof response.json !== 'object') {
    throw new Error(`YooKassa getPayment failed (${response.status})`);
  }
  const body = response.json as ProviderPaymentSnapshot;
  if (!body.id || !body.amount?.value || !body.amount?.currency) {
    throw new Error('YooKassa getPayment response incomplete');
  }
  return body;
}

export type ProcessYooKassaEventInput = {
  eventType: string;
  eventId: string;
  providerPaymentId: string;
  /** When true, skip webhook dedupe claim (used by return-page refresh). */
  skipWebhookDedupe?: boolean;
};

export type ProcessYooKassaEventResult = {
  ok: boolean;
  handled: boolean;
  status?: PaymentStatus;
  paymentId?: string;
  reason?: string;
};

export async function processYooKassaPaymentEvent(
  input: ProcessYooKassaEventInput,
): Promise<ProcessYooKassaEventResult> {
  let claimed = false;
  try {
    if (!input.skipWebhookDedupe) {
      claimed = await claimWebhookEvent('yookassa', input.eventId);
      if (!claimed) {
        return { ok: true, handled: false, reason: 'duplicate_event' };
      }
    }

    const authoritative = await fetchAuthoritativeYooKassaPayment(input.providerPaymentId);
    const nextStatus = mapProviderStatus(authoritative.status);

    let payment =
      (await getPaymentByTransactionId(authoritative.id)) ??
      (authoritative.metadata?.payment_id
        ? await getPaymentById(authoritative.metadata.payment_id)
        : null);

    if (!payment) {
      if (claimed) await releaseWebhookEvent('yookassa', input.eventId);
      return { ok: false, handled: false, reason: 'unknown_payment' };
    }

    const providerAmount = amountMinorFromProvider(authoritative.amount.value);
    if (providerAmount !== payment.amount) {
      if (claimed) await releaseWebhookEvent('yookassa', input.eventId);
      return { ok: false, handled: false, reason: 'amount_mismatch' };
    }
    if (authoritative.amount.currency !== payment.currency) {
      if (claimed) await releaseWebhookEvent('yookassa', input.eventId);
      return { ok: false, handled: false, reason: 'currency_mismatch' };
    }

    if (!canTransitionPaymentStatus(payment.status, nextStatus)) {
      return {
        ok: true,
        handled: false,
        status: payment.status,
        paymentId: payment.id,
        reason: 'stale_or_illegal_transition',
      };
    }

    const patch: Partial<PaymentRequest> = {
      status: nextStatus,
      providerTransactionId: authoritative.id,
      updatedAt: new Date(),
    };
    if (nextStatus === 'paid' && !payment.paidAt) {
      patch.paidAt = new Date();
    }

    const updated = await updatePaymentRecord(payment.id, patch);
    if (updated.status === 'paid') {
      await activateEntitlementForPaidPayment(updated);
    }

    return {
      ok: true,
      handled: true,
      status: updated.status,
      paymentId: updated.id,
    };
  } catch (error) {
    if (claimed) await releaseWebhookEvent('yookassa', input.eventId);
    throw error;
  }
}
