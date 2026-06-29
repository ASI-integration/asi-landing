import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { listBookingOpsEvents } from '@/lib/booking-ops/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const result = await listBookingOpsEvents(context.params.id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.error || 'Не удалось загрузить операционную историю.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, events: result.events });
}
