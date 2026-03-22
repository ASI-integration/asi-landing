import { StripeProvider } from './stripe';
import { YookassaProvider } from './yookassa';
import { PaymentProvider, PaymentRequest, PaymentMetadata } from './types';
import { createPaymentRecord } from './db';

const stripe = new StripeProvider();
const yookassa = new YookassaProvider();

export function getProvider(name: 'stripe' | 'yookassa'): PaymentProvider {
  return name === 'stripe' ? stripe : yookassa;
}

export async function createPaymentRequest(
  amount: number,
  currency: 'USD' | 'RUB',
  metadata: PaymentMetadata
): Promise<PaymentRequest> {
  const providerName = currency === 'RUB' ? 'yookassa' : 'stripe';
  const internalId = `pay_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Partial creation
  const partial: PaymentRequest = {
    id: internalId,
    provider: providerName,
    providerTransactionId: null,
    amount,
    currency,
    status: 'pending',
    metadata,
    createdAt: new Date(),
    updatedAt: new Date(),
    checkoutUrl: null,
  };

  const provider = getProvider(providerName);
  
  // Actually create checkout session
  const { checkoutUrl, transactionId } = await provider.createPaymentLink({
    amount,
    currency,
    metadata,
  });

  partial.checkoutUrl = checkoutUrl;
  partial.providerTransactionId = transactionId;

  // Persist
  await createPaymentRecord(partial);

  return partial;
}
