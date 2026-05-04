import { NextRequest, NextResponse } from 'next/server';
import {
  createLocationReportRequest,
  type LocationReportPaymentProvider,
} from '@/lib/location/report-request-store';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';

export const dynamic = 'force-dynamic';

function parseLocale(v: unknown): 'ru' | 'en' {
  return v === 'en' ? 'en' : 'ru';
}

function parseMode(v: unknown): 'residential' | 'commercial' {
  return v === 'commercial' ? 'commercial' : 'residential';
}

function resolveRuPaymentProvider(): LocationReportPaymentProvider {
  return process.env.LOCATION_REPORT_PAYMENT_PROVIDER === 'prodamus'
    ? 'prodamus'
    : 'manual';
}

function resolveRuPaymentUrl(provider: LocationReportPaymentProvider): string | null {
  if (provider === 'prodamus') {
    return process.env.LOCATION_REPORT_PAYMENT_URL || process.env.PRODAMUS_PAYMENT_URL || null;
  }

  return process.env.LOCATION_REPORT_PAYMENT_URL || null;
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const address = typeof body?.address === 'string' ? body.address.trim() : '';
  if (!address) return NextResponse.json({ error: 'address required' }, { status: 400 });

  const lat = typeof body?.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null;
  const lon = typeof body?.lon === 'number' && Number.isFinite(body.lon) ? body.lon : null;
  const locale = parseLocale(body?.locale);
  const mode = parseMode(body?.mode);
  const email = typeof body?.email === 'string' && body.email.includes('@')
    ? body.email.trim()
    : null;

  // Delivery is optional in this MVP: we persist intent, but actual sending is handled later.
  const deliveryChannel = body?.delivery?.channel;
  const deliveryTarget = body?.delivery?.target;
  const delivery =
    (deliveryChannel === 'email' || deliveryChannel === 'telegram' || deliveryChannel === 'dashboard')
    && typeof deliveryTarget === 'string'
    && deliveryTarget.trim()
      ? { channel: deliveryChannel as any, target: deliveryTarget.trim() }
      : null;

  let userId: string | null = null;
  let accountId: string | null = null;
  let sessionEmail: string | null = null;

  if (isSessionSecretConfigured()) {
    try {
      const session = await getSession();
      userId = session.userId ?? null;
      sessionEmail = session.email ?? null;
      const resolvedAccountId = userId ? await resolveAccountIdForUser(userId) : null;
      accountId = resolvedAccountId === 'legacy' ? null : resolvedAccountId;
    } catch {
      // Public RU order can be created without auth; account binding is best-effort.
    }
  }

  const isRuPaidProduct = locale === 'ru';
  const paymentProvider = isRuPaidProduct ? resolveRuPaymentProvider() : 'manual';
  const paymentUrl = isRuPaidProduct ? resolveRuPaymentUrl(paymentProvider) : null;
  const accessTier = isRuPaidProduct
    ? 'paid_required'
    : body?.access_tier === 'included' || body?.access_tier === 'paid_required'
      ? body.access_tier
      : 'unknown';
  const accessStatus = isRuPaidProduct ? 'pending_payment' : 'draft';

  try {
    const { requestId } = await createLocationReportRequest({
      locale,
      mode,
      address,
      lat,
      lon,
      delivery,
      accessTier,
      accessStatus,
      paymentProvider,
      paymentUrl,
      userId,
      accountId,
      email: email ?? sessionEmail,
      productType: 'location_report_detail',
    });

    return NextResponse.json({
      requestId,
      report_request_id: requestId,
      status: 'queued',
      access_status: accessStatus,
      payment_provider: paymentProvider,
      payment_url: paymentUrl,
      product_type: 'location_report_detail',
      next_action: isRuPaidProduct
        ? {
          type: 'payment_required',
          url: `/ru/location-report?requestId=${encodeURIComponent(requestId)}`,
        }
        : {
          type: 'process_async',
        },
      note: locale === 'ru'
        ? 'Заявка на полный отчёт создана. Доступ к полному отчёту откроется после подтверждения оплаты.'
        : 'The full report runs asynchronously. Dense urban areas may take up to ~1 minute.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'create_failed', detail: msg }, { status: 502 });
  }
}

