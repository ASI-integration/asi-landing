import { NextResponse } from 'next/server';
import {
  opsFoundationApiErrorResponse,
  readJsonObject,
  requireOpsFoundationContext,
} from '@/lib/ops-foundation/api';
import { parseUpdateMasterCardInput } from '@/lib/ops-foundation/parsers';
import { getMasterCard, updateMasterCard } from '@/lib/ops-foundation/repository';

export const dynamic = 'force-dynamic';

type RouteParams = { params: { id: string } };

export async function GET(_: Request, { params }: RouteParams) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  try {
    const masterCard = await getMasterCard(auth.ctx, params.id);
    if (!masterCard) {
      return NextResponse.json({ ok: false, error: 'master_card_not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, masterCard });
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }
    return opsFoundationApiErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const input = parseUpdateMasterCardInput(await readJsonObject(req));

  try {
    const masterCard = await updateMasterCard(auth.ctx, params.id, input);
    return NextResponse.json({ ok: true, masterCard });
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }
    return opsFoundationApiErrorResponse(err);
  }
}
