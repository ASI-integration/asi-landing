import { NextResponse } from 'next/server';
import { requireBookingOpsApiAccess } from '../access';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { requireBookingOpsRecordScope, updateBookingOpsRecord } from '@/lib/booking-ops/repository';
import { parseUpdateBookingOpsInput } from '@/lib/booking-ops/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };

  try {
    const record = await requireBookingOpsRecordScope(access.bookingId, expectedScope);
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const status = code === 'booking_scope_mismatch' ? 403 : code === 'booking_not_found' ? 404 : 500;
    return NextResponse.json({ ok: false, message: status === 403 ? 'Нет доступа к бронированию.' : 'Запись не найдена.' }, { status });
  }
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };

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

  const result = await updateBookingOpsRecord(access.bookingId, parsed.input, {
    actorType: 'admin',
    expectedScope,
  });
  if (!result.ok || !result.record) {
    const status = result.error === 'scope_mismatch' ? 403 : result.error === 'not_found' ? 404 : 500;
    return NextResponse.json(
      { ok: false, message: status === 403 ? 'Нет доступа к бронированию.' : result.error ?? 'Не удалось сохранить изменения.' },
      { status },
    );
  }

  return NextResponse.json({ ok: true, record: result.record });
}
