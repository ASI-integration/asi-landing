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
  if (requestId) params.set('requestId', requestId);
  return `${app}/ru/location-report/status${params.toString() ? `?${params.toString()}` : ''}`;
}
