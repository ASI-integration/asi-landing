export const COMMUNICATION_PILOT_SERVICE_TITLE =
  'Ранний доступ: AI-коммуникации для посуточной аренды';
export const COMMUNICATION_PILOT_PAYMENT_DESCRIPTION =
  'AI-коммуникации для посуточной аренды, 1 объект, 1 месяц';
export const COMMUNICATION_PILOT_PRICE_RUB = 1000;
export const COMMUNICATION_PILOT_PRICE_KOPEKS = COMMUNICATION_PILOT_PRICE_RUB * 100;
export const COMMUNICATION_PILOT_SERVICE_TYPE = 'communication_pilot_object_month';
export const COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE =
  'Оплата пилота AI-коммуникаций будет доступна после подключения платежей. Услуга: AI-коммуникации для посуточной аренды, 1 объект, 1 месяц.';

export const YOOKASSA_PENDING_REVIEW_MESSAGE =
  'Оплата будет подключена после финальной проверки отчёта. Сейчас доступна ссылка на сформированный отчёт.';

function getAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function isYooKassaEnabled(): boolean {
  return process.env.YOOKASSA_ENABLED === 'true';
}

export function getYooKassaCredentials(): { shopId: string; secretKey: string } | null {
  if (!isYooKassaEnabled()) return null;

  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();
  if (!shopId || !secretKey) return null;
  return { shopId, secretKey };
}

export function getYooKassaReturnUrl(requestId?: string): string {
  const app = getAppBaseUrl();
  const params = new URLSearchParams();
  params.set('service', COMMUNICATION_PILOT_SERVICE_TYPE);
  if (requestId) params.set('paymentId', requestId);
  return `${app}/payments/success?${params.toString()}`;
}
