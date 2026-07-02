import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { getMarketSignalCoverage } from '@/lib/booking-ops/market-signals-ingestion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  try {
    const propertySetupId = new URL(req.url).searchParams.get('propertySetupId') ?? '';
    return NextResponse.json({ ok: true, coverage: await getMarketSignalCoverage(propertySetupId) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось рассчитать покрытие.' }, { status: 400 });
  }
}
