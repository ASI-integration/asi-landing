import { randomUUID } from 'node:crypto';
import { StripeProvider } from './stripe';
import { YookassaProvider } from './yookassa';
import { PaymentProvider, PaymentProviderType, PaymentRequest } from './types';
import {
  createPaymentRecord,
  getActivePaymentForContext,
  getPaymentByIdempotencyKey,
} from './db';
import { getPaymentProduct } from './catalog';
import { getYooKassaConfig, isYooKassaEnabled } from './yookassa-env';

const providers: Record<PaymentProviderType, PaymentProvider> = {
  stripe: new StripeProvider(),
  yookassa: new YookassaProvider(),
};

export function getProvider(name: PaymentProviderType): PaymentProvider {
  return providers[name];
}

function resolveProvider(currency: string, explicit?: PaymentProviderType): PaymentProviderType {
  if (explicit) return explicit;
  if (currency === 'RUB') return 'yookassa';
  return 'stripe';
}

export interface CreatePaymentParams {
  amount: number;
  currency: string;
  chatId?: string;
  reservationId?: string;
  propertyId?: string;
  listingId?: string;
  guestId?: string;
  ownerId?: string;
  description?: string;
  serviceType?: string;
  expiresAt?: Date;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
  provider?: PaymentProviderType;
}

/**
 * MVP entry: create payment for a catalog product.
 * Amount/currency always come from the server catalog — never from the client.
 */
export async function createPaymentForProduct(params: {
  productId: string;
  ownerId?: string;
  chatId?: string;
  propertyId?: string;
  guestId?: string;
  reservationId?: string;
  idempotencyKey?: string;
}): Promise<PaymentRequest> {
  const product = getPaymentProduct(params.productId);
  const idempotencyKey =
    params.idempotencyKey ??
    [
      'yk',
      product.id,
      params.ownerId ?? params.chatId ?? params.guestId ?? 'anon',
      params.propertyId ?? 'na',
    ].join(':');

  return createPaymentRequest({
    amount: product.amountMinor,
    currency: product.currency,
    chatId: params.chatId,
    reservationId: params.reservationId,
    propertyId: params.propertyId,
    guestId: params.guestId,
    ownerId: params.ownerId,
    description: product.description,
    serviceType: product.serviceType,
    idempotencyKey,
    metadata: { product_id: product.id },
    provider: 'yookassa',
  });
}

/**
 * Creates a provider payment session and persists the record.
 * Prefer createPaymentForProduct for ASI MVP flows.
 */
export async function createPaymentRequest(params: CreatePaymentParams): Promise<PaymentRequest> {
  if (params.idempotencyKey) {
    const existingByKey = await getPaymentByIdempotencyKey(params.idempotencyKey);
    if (existingByKey) return existingByKey;
  }

  if (params.chatId) {
    const active = await getActivePaymentForContext(params.chatId);
    if (active) return active;
  }

  const providerName = resolveProvider(params.currency, params.provider);
  const id = `pay_${randomUUID()}`;
  const now = new Date();

  const requestForProvider: Omit<
    PaymentRequest,
    'provider' | 'providerTransactionId' | 'status' | 'createdAt' | 'updatedAt' | 'paymentUrl'
  > = {
    id,
    amount: params.amount,
    currency: params.currency,
    chatId: params.chatId,
    reservationId: params.reservationId,
    propertyId: params.propertyId,
    listingId: params.listingId,
    guestId: params.guestId,
    ownerId: params.ownerId,
    description: params.description,
    serviceType: params.serviceType,
    expiresAt: params.expiresAt,
    idempotencyKey: params.idempotencyKey ?? id,
    metadata: params.metadata,
  };

  const provider = getProvider(providerName);
  if (providerName === 'yookassa') {
    // Fail closed on misconfigured live/test credentials.
    if (isYooKassaEnabled()) {
      getYooKassaConfig();
    }
    if (provider instanceof YookassaProvider && !isYooKassaEnabled()) {
      const disabled = await provider.createPayment(requestForProvider);
      const record: PaymentRequest = {
        ...requestForProvider,
        provider: providerName,
        providerTransactionId: disabled.transactionId,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      await createPaymentRecord(record);
      return record;
    }
  }

  const { paymentUrl, transactionId } = await provider.createPaymentLink(requestForProvider);

  const record: PaymentRequest = {
    ...requestForProvider,
    provider: providerName,
    providerTransactionId: transactionId,
    status: 'pending',
    paymentUrl,
    createdAt: now,
    updatedAt: now,
  };

  await createPaymentRecord(record);
  return record;
}
