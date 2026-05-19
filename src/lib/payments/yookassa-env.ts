export const YOOKASSA_PENDING_REVIEW_MESSAGE =
  'Оплата будет подключена после финальной проверки отчёта. Сейчас доступна ссылка на сформированный отчёт.';

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

export function getYooKassaReturnUrl(): string {
  const explicit = process.env.YOOKASSA_RETURN_URL?.trim();
  if (explicit) return explicit;
  const app = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${app}/dashboard?payment=success`;
}
