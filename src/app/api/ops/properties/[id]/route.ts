import { NextResponse } from 'next/server';
import {
  opsFoundationApiErrorResponse,
  readJsonObject,
  requireOpsFoundationContext,
} from '@/lib/ops-foundation/api';
import { parseUpdatePropertyInput } from '@/lib/ops-foundation/parsers';
import { getProperty, updateProperty } from '@/lib/ops-foundation/repository';

export const dynamic = 'force-dynamic';

type RouteParams = { params: { id: string } };

export async function GET(_: Request, { params }: RouteParams) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  try {
    const property = await getProperty(auth.ctx, params.id);
    if (!property) {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, property });
  } catch (err) {
    return opsFoundationApiErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const input = parseUpdatePropertyInput(await readJsonObject(req));

  try {
    const property = await updateProperty(auth.ctx, params.id, input);
    return NextResponse.json({ ok: true, property });
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }
    return opsFoundationApiErrorResponse(err);
  }
}
