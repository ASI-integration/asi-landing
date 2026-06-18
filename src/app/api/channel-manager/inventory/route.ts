import { NextResponse } from 'next/server';
import { readJsonObject, requireOpsFoundationContext } from '@/lib/ops-foundation/api';
import { channelManagerApiErrorResponse, parseSetInventoryInput } from '@/lib/channel-manager/api';
import { setInventoryDay } from '@/lib/channel-manager/repository';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const input = parseSetInventoryInput(await readJsonObject(req));
  if (!input) {
    return NextResponse.json({ ok: false, error: 'property_day_and_units_required' }, { status: 400 });
  }

  try {
    const result = await setInventoryDay(auth.ctx, input);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return channelManagerApiErrorResponse(err);
  }
}
