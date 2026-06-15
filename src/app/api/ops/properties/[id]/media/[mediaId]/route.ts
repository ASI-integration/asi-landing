import { NextResponse } from 'next/server';
import {
  opsFoundationApiErrorResponse,
  readJsonObject,
  requireOpsFoundationContext,
} from '@/lib/ops-foundation/api';
import { parseUpdateMediaInput } from '@/lib/ops-foundation/parsers';
import { deletePropertyMedia, updatePropertyMedia } from '@/lib/ops-foundation/repository';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type RouteParams = { params: { id: string; mediaId: string } };

async function removeStoredMedia(storagePath: string | null): Promise<void> {
  if (!storagePath) return;
  const [bucket, ...pathParts] = storagePath.split('/');
  const path = pathParts.join('/');
  if (!bucket || !path) return;
  try {
    await supabase.storage.from(bucket).remove([path]);
  } catch {
    // DB visibility is the source of truth; a missing storage object should not block removal from the UI.
  }
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  const input = parseUpdateMediaInput(await readJsonObject(req));

  try {
    const media = await updatePropertyMedia(auth.ctx, params.id, params.mediaId, input);
    return NextResponse.json({ ok: true, media });
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }
    if (err instanceof Error && err.message === 'media_not_found') {
      return NextResponse.json({ ok: false, error: 'media_not_found' }, { status: 404 });
    }
    return opsFoundationApiErrorResponse(err);
  }
}

export async function DELETE(_: Request, { params }: RouteParams) {
  const auth = await requireOpsFoundationContext();
  if (!auth.ok) return auth.response;

  try {
    const media = await deletePropertyMedia(auth.ctx, params.id, params.mediaId);
    await removeStoredMedia(media.storagePath);
    return NextResponse.json({ ok: true, media });
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }
    if (err instanceof Error && err.message === 'media_not_found') {
      return NextResponse.json({ ok: false, error: 'media_not_found' }, { status: 404 });
    }
    return opsFoundationApiErrorResponse(err);
  }
}
