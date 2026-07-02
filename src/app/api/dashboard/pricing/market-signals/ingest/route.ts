import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { ingestManualMarketSnapshot } from '@/lib/booking-ops/market-signals-ingestion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 }); }
  try {
    const propertySetupId = typeof body.propertySetupId === 'string' ? body.propertySetupId : '';
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : undefined;
    const result = await ingestManualMarketSnapshot(propertySetupId, body.snapshot ?? body.signals, metadata);
    return NextResponse.json({ ok: true, ...result, count: result.signals.length });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить снимок.' }, { status: 400 });
  }
}
