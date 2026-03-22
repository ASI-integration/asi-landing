import { StripeProvider } from './stripe';
import { YookassaProvider } from './yookassa';
import { PaymentProvider, PaymentProviderType, PaymentRequest } from './types';
import { createPaymentRecord, getActivePaymentForContext } from './db';

const providers: Record<PaymentProviderType, PaymentProvider> = {
  stripe: new StripeProvider(),
  yookassa: new YookassaProvider(),
};

export function getProvider(name: PaymentProviderType): PaymentProvider {
  return providers[name];
}

/**
 * Resolves the payment provider for a given request.
 *
 * Priority:
 *   1. Explicit provider if passed in params
 *   2. Business config: RUB → yookassa
 *   3. Currency fallback: all others → stripe
 */
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
  description?: string;
  serviceType?: string;
  expiresAt?: Date;
  /** Override provider explicitly; omit to let resolveProvider decide. */
  provider?: PaymentProviderType;
}

/**
 * Creates a real provider payment session and persists the record.
 *
 * Returns an existing active (pending / requires_action) payment for the same
 * chatId if one already exists — preventing duplicate checkout sessions for
 * the same guest context.
 */
export async function createPaymentRequest(params: CreatePaymentParams): Promise<PaymentRequest> {
  // Deduplicate: reuse active unpaid session for the same chat
  if (params.chatId) {
    const active = await getActivePaymentForContext(params.chatId);
    if (active) return active;
  }

  const providerName = resolveProvider(params.currency, params.provider);
  const id = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date();

  // Build the request sent to the provider (no status/provider-assigned fields yet)
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
    description: params.description,
    serviceType: params.serviceType,
    expiresAt: params.expiresAt,
  };

  const provider = getProvider(providerName);
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
