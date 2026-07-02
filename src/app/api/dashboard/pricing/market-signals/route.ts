import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { getMarketSignalsSummary } from '@/lib/booking-ops/market-signals-ingestion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const url = new URL(req.url);
  const propertySetupId = url.searchParams.get('propertySetupId') ?? '';
  try {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const summary = await getMarketSignalsSummary(propertySetupId, from && to ? { from, to } : undefined);
    return NextResponse.json({ ok: true, ...summary, externalProvidersLive: false, otaPricePush: false });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось получить сигналы.' }, { status: 400 });
  }
}
