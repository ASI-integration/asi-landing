import { NextResponse } from 'next/server';
import { readJsonObject, requireOpsFoundationContext } from '@/lib/ops-foundation/api';
import { channelManagerApiErrorResponse } from '@/lib/channel-manager/api';
import { createBronevikMtsTravelDryRun } from '@/lib/channel-manager/repository';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(req);
  const propertyId = typeof body.propertyId === 'string' ? body.propertyId : '';
  const unitKey = typeof body.unitKey === 'string' ? body.unitKey : 'default';
  const dateFrom = typeof body.dateFrom === 'string' ? body.dateFrom : '';
  const dateTo = typeof body.dateTo === 'string' ? body.dateTo : '';

  if (!propertyId || !dateFrom || !dateTo) {
    return NextResponse.json({ ok: false, error: 'bronevik_dry_run_payload_required' }, { status: 400 });
  }

  try {
    const result = await createBronevikMtsTravelDryRun(auth.ctx, {
      propertyId,
      unitKey,
      dateFrom,
      dateTo,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}
