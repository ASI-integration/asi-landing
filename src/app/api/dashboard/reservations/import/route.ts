import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { commitCsvImport, previewCsvImport, type CsvMapping } from '@/lib/reservations/csv-import';
import { reservationSourceTypes, type ReservationSourceType } from '@/lib/reservations/types';

export async function POST(req: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  try {
    const access = await resolveReservationAccess(auth.session);
    const body = await req.json() as Record<string, unknown>;
    const mapping = (body.mapping && typeof body.mapping === 'object' ? body.mapping : {}) as CsvMapping;
    const sourceType = reservationSourceTypes.includes(body.sourceType as ReservationSourceType) ? body.sourceType as ReservationSourceType : undefined;
    const rows = previewCsvImport({ csv: String(body.csv ?? ''), mapping, accountId: access.accountId, actorId: access.actorId, sourceType, propertyIds: Array.isArray(body.propertyIds) ? body.propertyIds.map(String) : [], unitIds: Array.isArray(body.unitIds) ? body.unitIds.map(String) : undefined });
    if (body.commit !== true) return NextResponse.json({ ok: true, dryRun: true, rows, summary: rows.reduce((summary, row) => ({ ...summary, [row.outcome]: (summary[row.outcome] ?? 0) + 1 }), {} as Record<string, number>) });
    if (!body.idempotencyKey) throw new Error('idempotency_key_required');
    return NextResponse.json({ ok: true, dryRun: false, result: await commitCsvImport({ accountId: access.accountId, actorId: access.actorId, idempotencyKey: String(body.idempotencyKey), rows, mapping }) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'import_failed' }, { status: 400 });
  }
}
