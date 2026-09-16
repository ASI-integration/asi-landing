/**
 * Server-authoritative payment catalog.
 * Client requests may only name a productId — never a trusted amount.
 */
export type PaymentProduct = {
  id: string;
  title: string;
  description: string;
  /** Amount in minor units (kopeks for RUB). */
  amountMinor: number;
  currency: 'RUB';
  serviceType: string;
};

export const ASI_MVP_PRODUCTS: Record<string, PaymentProduct> = {
  communication_pilot_object_month: {
    id: 'communication_pilot_object_month',
    title: 'Ранний доступ: AI-коммуникации для посуточной аренды',
    description: 'AI-коммуникации для посуточной аренды, 1 объект, 1 месяц',
    amountMinor: 100_000, // 1000.00 RUB
    currency: 'RUB',
    serviceType: 'communication_pilot_object_month',
  },
};

export function getPaymentProduct(productId: string): PaymentProduct {
  const product = ASI_MVP_PRODUCTS[productId];
  if (!product) {
    throw new Error(`Unknown payment product: ${productId}`);
  }
  return product;
}
