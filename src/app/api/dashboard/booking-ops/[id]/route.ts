import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { getBookingOpsRecord, updateBookingOpsRecord } from '@/lib/booking-ops/repository';
import { parseUpdateBookingOpsInput } from '@/lib/booking-ops/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  const record = await getBookingOpsRecord(context.params.id);
  if (!record) {
    return NextResponse.json({ ok: false, message: 'Запись не найдена.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, record });
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const parsed = parseUpdateBookingOpsInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ ok: false, message: parsed.error }, { status: 400 });
  }

  const result = await updateBookingOpsRecord(context.params.id, parsed.input);
  if (!result.ok || !result.record) {
    const status = result.error === 'not_found' ? 404 : 500;
    return NextResponse.json(
      { ok: false, message: result.error ?? 'Не удалось сохранить изменения.' },
      { status },
    );
  }

  return NextResponse.json({ ok: true, record: result.record });
}
