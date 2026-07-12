import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { assignLegacyReservations, previewLegacyReservations } from '@/lib/reservations/legacy-bootstrap';

export async function GET(req: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  try {
    const targetAccountId = new URL(req.url).searchParams.get('targetAccountId') ?? '';
    return NextResponse.json({ ok: true, dryRun: true, targetAccountId, reservations: await previewLegacyReservations(targetAccountId) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'legacy_preview_failed' }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  try {
    const body = await req.json() as { targetAccountId?: string; selectedIds?: string[]; confirm?: boolean };
    const result = await assignLegacyReservations({ targetAccountId: body.targetAccountId ?? '', selectedIds: Array.isArray(body.selectedIds) ? body.selectedIds.map(String) : [], actorId: auth.session.userId!, confirm: body.confirm === true });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'legacy_assignment_failed' }, { status: 400 });
  }
}
