import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { listBookingOpsRecords } from '@/lib/booking-ops/repository';
import { buildCrmBookingSignals } from '@/lib/crm/booking-signals';
import { buildHospitalityOperatorBoard } from '@/lib/booking-ops/hospitality-operator-board';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const listed = await listBookingOpsRecords({ limit: 100 });
  if (!listed.ok) {
    return NextResponse.json(
      { ok: false, message: listed.error ?? 'Не удалось загрузить операционную доску.' },
      { status: 500 },
    );
  }

  const nowIso = new Date().toISOString();
  const signals = buildCrmBookingSignals(listed.records, [], new Map(), nowIso);
  const board = buildHospitalityOperatorBoard(listed.records, signals, nowIso);

  return NextResponse.json({
    ok: true,
    board,
    refreshedAt: nowIso,
  });
}
