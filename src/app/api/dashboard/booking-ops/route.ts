import { NextResponse } from 'next/server';
import { isOpsAdminEmail } from '@/lib/crm/access';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { createBookingOpsRecord, listBookingOpsRecords } from '@/lib/booking-ops/repository';
import { parseCreateBookingOpsInput } from '@/lib/booking-ops/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const result = await listBookingOpsRecords();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.error ?? 'Не удалось загрузить операционные брони.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    records: result.records,
    refreshedAt: new Date().toISOString(),
    isOpsAdmin: isOpsAdminEmail(auth.session.email),
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const parsed = parseCreateBookingOpsInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ ok: false, message: parsed.error }, { status: 400 });
  }

  const result = await createBookingOpsRecord(parsed.input);
  if (!result.ok || !result.record) {
    return NextResponse.json(
      { ok: false, message: result.error ?? 'Не удалось создать операционную запись.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, record: result.record }, { status: 201 });
}
