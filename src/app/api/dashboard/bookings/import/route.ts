import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { importBookingFromText } from '@/lib/bookings/import-service';
import { listPilotObjectSnapshots } from '@/lib/pilot-readiness/repository';

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

  const text = String(body.text ?? '').trim();
  if (!text) {
    return NextResponse.json({ ok: false, message: 'Вставьте текст брони.' }, { status: 400 });
  }

  const snapshots = await listPilotObjectSnapshots({ includeTest: false });
  const properties = snapshots.map((item) => ({
    propertyId: item.propertyId,
    label: item.objectLabel ?? item.name ?? item.propertyId,
  }));

  const result = await importBookingFromText({
    text,
    properties,
    forceCreate: Boolean(body.forceCreate),
  });

  if (!result.ok && !result.needsReview) {
    return NextResponse.json(
      { ok: false, message: result.message, candidate: result.candidate, error: result.error },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    created: result.created,
    needsReview: result.needsReview,
    bookingId: result.bookingId,
    candidate: result.candidate,
    message: result.message,
    sync: result.sync,
  });
}
