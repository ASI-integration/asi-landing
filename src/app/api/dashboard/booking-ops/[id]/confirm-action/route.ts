import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { applyBookingOpsOperatorAction } from '@/lib/booking-ops/action-templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const actionId = String(body.actionId ?? body.action_id ?? '').trim();
  if (!actionId) {
    return NextResponse.json({ ok: false, message: 'Укажите действие (actionId).' }, { status: 400 });
  }

  const result = await applyBookingOpsOperatorAction(context.params.id, actionId);
  if (!result.ok) {
    const status = result.error === 'not_found' ? 404 : 400;
    return NextResponse.json(
      { ok: false, message: result.error },
      { status },
    );
  }

  return NextResponse.json({ ok: true, record: result.record });
}
