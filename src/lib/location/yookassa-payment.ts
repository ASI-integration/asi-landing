import { getYooKassaCredentials } from '@/lib/payments/yookassa-env';

const DEFAULT_LOCATION_REPORT_PRICE_RUB = 990;

function getLocationReportPriceRub(): number {
  const raw = process.env.LOCATION_REPORT_PRICE_RUB
    || process.env.NEXT_PUBLIC_LOCATION_REPORT_PRICE_RUB;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOCATION_REPORT_PRICE_RUB;
}

function getAppOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'http://localhost:3000'
  ).replace(/\/$/, '');
}

function buildReceiptEmail(email: string | null): { email: string } | undefined {
  return email && email.includes('@') ? { email } : undefined;
}

export type LocationReportYooKassaPayment = {
  paymentId: string;
  paymentUrl: string;
  raw: unknown;
};

export async function createLocationReportYooKassaPayment(args: {
  requestId: string;
  email: string | null;
  description?: string;
}): Promise<LocationReportYooKassaPayment> {
  const creds = getYooKassaCredentials();
  if (!creds) throw new Error('yookassa_not_configured');

  const amountRub = getLocationReportPriceRub();
  const amountValue = amountRub.toFixed(2);
  const auth = Buffer.from(`${creds.shopId}:${creds.secretKey}`).toString('base64');
  const returnUrl = `${getAppOrigin()}/ru/location-report?requestId=${encodeURIComponent(args.requestId)}`;
  const customer = buildReceiptEmail(args.email);

  const body: Record<string, unknown> = {
    amount: { value: amountValue, currency: 'RUB' },
    confirmation: {
      type: 'redirect',
      return_url: returnUrl,
    },
    capture: true,
    description: args.description ?? 'ASI: полный отчет по локации',
    metadata: {
      location_report_request_id: args.requestId,
      locationReportRequestId: args.requestId,
      product_type: 'location_report_detail',
      productType: 'location_report_detail',
    },
  };

  if (customer) {
    body.receipt = {
      customer,
      items: [
        {
          description: 'ASI: полный отчет по локации',
          quantity: 1,
          amount: { value: amountValue, currency: 'RUB' },
          vat_code: 6,
          payment_mode: 'full_payment',
          payment_subject: 'service',
        },
      ],
    };
  }

  const res = await fetch('https://api.yookassa.ru/v3/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
      'Idempotence-Key': `location-report-${args.requestId}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`yookassa_create_failed:${res.status}:${await res.text()}`);
  }

  const data = await res.json() as {
    id?: string;
    confirmation?: { confirmation_url?: string };
  };
  const paymentId = data.id;
  const paymentUrl = data.confirmation?.confirmation_url;

  if (!paymentId || !paymentUrl) throw new Error('yookassa_missing_confirmation');
  return { paymentId, paymentUrl, raw: data };
}
