import { ASI_MVP_PRODUCTS } from './catalog';

export const COMMUNICATION_PILOT_SERVICE_TITLE =
  ASI_MVP_PRODUCTS.communication_pilot_object_month.title;
export const COMMUNICATION_PILOT_PAYMENT_DESCRIPTION =
  ASI_MVP_PRODUCTS.communication_pilot_object_month.description;
export const COMMUNICATION_PILOT_PRICE_RUB =
  ASI_MVP_PRODUCTS.communication_pilot_object_month.amountMinor / 100;
export const COMMUNICATION_PILOT_PRICE_KOPEKS =
  ASI_MVP_PRODUCTS.communication_pilot_object_month.amountMinor;
export const COMMUNICATION_PILOT_SERVICE_TYPE =
  ASI_MVP_PRODUCTS.communication_pilot_object_month.serviceType;
export const COMMUNICATION_PILOT_PAYMENT_PENDING_MESSAGE =
  'Оплата пилота AI-коммуникаций будет доступна после подключения платежей. Услуга: AI-коммуникации для посуточной аренды, 1 объект, 1 месяц.';

export const YOOKASSA_PENDING_REVIEW_MESSAGE =
  'Оплата будет подключена после финальной проверки отчёта. Сейчас доступна ссылка на сформированный отчёт.';

export type YooKassaMode = 'test' | 'live';

export type YooKassaConfig = {
  enabled: boolean;
  mode: YooKassaMode;
  shopId: string;
  secretKey: string;
  returnUrlBase: string;
};

function getAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_URL || 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
}

export function isYooKassaEnabled(): boolean {
  return process.env.YOOKASSA_ENABLED === 'true';
}

export function getYooKassaMode(): YooKassaMode {
  const raw = (process.env.YOOKASSA_MODE || 'test').trim().toLowerCase();
  if (raw === 'live') return 'live';
  if (raw === 'test') return 'test';
  throw new Error(`Invalid YOOKASSA_MODE="${process.env.YOOKASSA_MODE}" (expected test|live)`);
}

/**
 * Fail-closed credential loader.
 * - Disabled unless YOOKASSA_ENABLED=true
 * - Live mode requires YOOKASSA_ALLOW_LIVE=true (explicit production opt-in)
 * - Secret key must look like a test key when mode=test (prefix test_ / TEST)
 */
export function getYooKassaConfig(): YooKassaConfig | null {
  if (!isYooKassaEnabled()) return null;

  const mode = getYooKassaMode();
  if (mode === 'live' && process.env.YOOKASSA_ALLOW_LIVE !== 'true') {
    throw new Error('Live YooKassa mode requires explicit YOOKASSA_ALLOW_LIVE=true');
  }

  const shopId = process.env.YOOKASSA_SHOP_ID?.trim();
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim();
  if (!shopId || !secretKey) {
    throw new Error('YooKassa enabled but YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY are missing');
  }

  if (mode === 'test') {
    const looksTest =
      /^test_/i.test(secretKey) ||
      secretKey.toLowerCase().includes('test') ||
      process.env.YOOKASSA_FORCE_TEST_KEY === 'true';
    if (!looksTest && process.env.NODE_ENV !== 'test') {
      throw new Error(
        'YOOKASSA_MODE=test but secret key does not look like a test credential (set YOOKASSA_FORCE_TEST_KEY=true only for local mocks)',
      );
    }
  }

  if (mode === 'live' && /^test_/i.test(secretKey)) {
    throw new Error('YOOKASSA_MODE=live cannot use a test_ secret key');
  }

  return {
    enabled: true,
    mode,
    shopId,
    secretKey,
    returnUrlBase: getAppBaseUrl(),
  };
}

/** Back-compat helper used by older call sites */
export function getYooKassaCredentials(): { shopId: string; secretKey: string } | null {
  try {
    const config = getYooKassaConfig();
    if (!config) return null;
    return { shopId: config.shopId, secretKey: config.secretKey };
  } catch {
    return null;
  }
}

export function getYooKassaReturnUrl(paymentId?: string): string {
  const app = getAppBaseUrl();
  const params = new URLSearchParams();
  params.set('service', COMMUNICATION_PILOT_SERVICE_TYPE);
  if (paymentId) params.set('paymentId', paymentId);
  // UX-only return page — never proof of payment.
  return `${app}/payments/return?${params.toString()}`;
}

/**
 * Optional receipt attachment point for 54-FZ / "Чеки от ЮKassa".
 * v1 leaves this null until legal inputs are resolved — do not invent VAT codes.
 */
export type YooKassaReceiptDraft = {
  customer?: { email?: string; phone?: string };
  items?: Array<{
    description: string;
    quantity: string;
    amount: { value: string; currency: string };
    vat_code?: number;
    payment_mode?: string;
    payment_subject?: string;
  }>;
} | null;

export function buildYooKassaReceiptDraft(_input: {
  description: string;
  amountValue: string;
  currency: string;
  customerEmail?: string;
}): YooKassaReceiptDraft {
  // Unresolved legal inputs — see docs/payments/YOOKASSA_MVP.md
  return null;
}
