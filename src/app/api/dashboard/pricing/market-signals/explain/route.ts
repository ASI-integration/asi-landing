import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { explainMarketSignals } from '@/lib/booking-ops/market-signals-ingestion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const url = new URL(req.url);
  try {
    return NextResponse.json({ ok: true, explanation: await explainMarketSignals(url.searchParams.get('propertySetupId') ?? '', url.searchParams.get('date') ?? undefined) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось объяснить сигналы.' }, { status: 400 });
  }
}
