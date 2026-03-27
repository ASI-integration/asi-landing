/**
 * Поддерживаются имена из ЛК ЮKassa (YOO_KASSA_*) и прежние YOOKASSA_*.
 */
export function getYooKassaCredentials(): { shopId: string; secretKey: string } | null {
  const shopId = process.env.YOO_KASSA_SHOP_ID || process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOO_KASSA_SECRET_KEY || process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) return null;
  return { shopId, secretKey };
}

export function getYooKassaReturnUrl(): string {
  const explicit = process.env.YOO_KASSA_RETURN_URL?.trim();
  if (explicit) return explicit;
  const app = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${app}/dashboard?payment=success`;
}
