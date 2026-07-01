import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { ingestMarketSignals } from '@/lib/booking-ops/pricing-intelligence-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const propertySetupId = typeof body.propertySetupId === 'string' ? body.propertySetupId : undefined;
  if (!propertySetupId) {
    return NextResponse.json({ ok: false, message: 'Укажите propertySetupId.' }, { status: 400 });
  }

  const metadata = body.metadata && typeof body.metadata === 'object'
    ? body.metadata as Record<string, unknown>
    : undefined;

  try {
    const snapshot = body.snapshot ?? body.signals ?? body;
    const signals = await ingestMarketSignals(propertySetupId, snapshot as never, metadata);
    return NextResponse.json({ ok: true, signals, count: signals.length });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить сигналы.' }, { status: 400 });
  }
}
