import { NextRequest, NextResponse } from 'next/server';
import { createLocationReportRequest } from '@/lib/location/report-request-store';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function parseLocale(v: unknown): 'ru' | 'en' {
  return v === 'en' ? 'en' : 'ru';
}

function parseMode(v: unknown): 'residential' | 'commercial' {
  return v === 'commercial' ? 'commercial' : 'residential';
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

  // Delivery is optional in this MVP: we persist intent, but actual sending is handled later.
  const deliveryChannel = body?.delivery?.channel;
  const deliveryTarget = body?.delivery?.target;
  const delivery =
    (deliveryChannel === 'email' || deliveryChannel === 'telegram' || deliveryChannel === 'dashboard')
    && typeof deliveryTarget === 'string'
    && deliveryTarget.trim()
      ? { channel: deliveryChannel as any, target: deliveryTarget.trim() }
      : null;

  // Monetization hook: for now we don’t enforce here; callers can show paywall based on their auth/subscription.
  const accessTier =
    body?.access_tier === 'included' || body?.access_tier === 'paid_required'
      ? body.access_tier
      : 'unknown';

  if (accessTier === 'paid_required') {
    const redirect = '/dashboard/reports';
    if (!isSessionSecretConfigured()) {
      return NextResponse.json(
        { error: 'auth_required', loginUrl: `/connect?redirect=${encodeURIComponent(redirect)}` },
        { status: 401 },
      );
    }
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json(
        { error: 'auth_required', loginUrl: `/connect?redirect=${encodeURIComponent(redirect)}` },
        { status: 401 },
      );
    }
  }

  try {
    const { requestId } = await createLocationReportRequest({
      locale,
      mode,
      address,
      lat,
      lon,
      delivery,
      accessTier,
    });

    return NextResponse.json({
      requestId,
      status: 'queued',
      note: locale === 'ru'
        ? 'Полный отчёт рассчитывается асинхронно. В плотных городских локациях расчёт может занять до ~1 минуты.'
        : 'The full report runs asynchronously. Dense urban areas may take up to ~1 minute.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'create_failed', detail: msg }, { status: 502 });
  }
}

