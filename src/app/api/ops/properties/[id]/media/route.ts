import { NextResponse } from 'next/server';
import {
  opsFoundationApiErrorResponse,
  readJsonObject,
  requireOpsFoundationContext,
} from '@/lib/ops-foundation/api';
import { parseCreateMediaInput } from '@/lib/ops-foundation/parsers';
import { addPropertyMedia, listPropertyMedia } from '@/lib/ops-foundation/repository';

export const dynamic = 'force-dynamic';

type RouteParams = { params: { id: string } };

export async function GET(_: Request, { params }: RouteParams) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  try {
    const media = await listPropertyMedia(auth.ctx, params.id);
    return NextResponse.json({ ok: true, media });
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }
    return opsFoundationApiErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const input = parseCreateMediaInput(await readJsonObject(req));
  if (!input) {
    return NextResponse.json({ ok: false, error: 'url_or_storage_path_required' }, { status: 400 });
  }

  try {
    const item = await addPropertyMedia(auth.ctx, params.id, input);
    return NextResponse.json({ ok: true, media: item }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }
    return opsFoundationApiErrorResponse(err);
  }
}
