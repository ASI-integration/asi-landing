import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { orchestrateDueBookingLifecycles } from '@/lib/booking-ops/lifecycle-orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let body: Record<string, unknown> = {};
  try { body = await req.json() as Record<string, unknown>; } catch { /* пустое тело допустимо */ }
  try {
    const result = await orchestrateDueBookingLifecycles({
      now: typeof body.now === 'string' ? body.now : undefined,
      limit: typeof body.limit === 'number' ? body.limit : undefined,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Пакетный запуск не выполнен.' }, { status: 400 });
  }
}
