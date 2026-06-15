import { NextResponse } from 'next/server';
import {
  opsFoundationApiErrorResponse,
  optionalString,
  readJsonObject,
  requireOpsFoundationContext,
} from '@/lib/ops-foundation/api';
import { parseCreateMediaInput } from '@/lib/ops-foundation/parsers';
import { addPropertyMedia, listPropertyMedia } from '@/lib/ops-foundation/repository';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type RouteParams = { params: { id: string } };
const PROPERTY_MEDIA_BUCKET = process.env.PROPERTY_MEDIA_BUCKET || 'property-media';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function extensionForUpload(file: File): string {
  const original = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (/^[a-z0-9]{2,5}$/.test(original)) return original;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'image/gif') return 'gif';
  return 'jpg';
}

function isMissingBucketError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const statusCode = String((error as { statusCode?: unknown }).statusCode ?? '');
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase();
  return statusCode === '404' || message.includes('not found');
}

function isExistingBucketError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const statusCode = String((error as { statusCode?: unknown }).statusCode ?? '');
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase();
  return statusCode === '409' || message.includes('already exists');
}

async function ensurePropertyMediaBucket(): Promise<void> {
  const { error } = await supabase.storage.getBucket(PROPERTY_MEDIA_BUCKET);
  if (!error) return;
  if (!isMissingBucketError(error)) throw error;

  const { error: createError } = await supabase.storage.createBucket(PROPERTY_MEDIA_BUCKET, {
    public: true,
  });
  if (createError && !isExistingBucketError(createError)) throw createError;
}

async function mediaInputFromForm(req: Request, propertyId: string) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return null;
  if (!file.type.startsWith('image/')) throw new Error('image_file_required');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('image_too_large');

  await ensurePropertyMediaBucket();

  const storagePath = [
    'properties',
    propertyId,
    `${Date.now()}-${crypto.randomUUID()}.${extensionForUpload(file)}`,
  ].join('/');
  const { error: uploadError } = await supabase.storage
    .from(PROPERTY_MEDIA_BUCKET)
    .upload(storagePath, await file.arrayBuffer(), {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from(PROPERTY_MEDIA_BUCKET).getPublicUrl(storagePath);
  const sortOrderValue = Number(form.get('sortOrder'));

  return {
    url: data.publicUrl,
    storagePath: `${PROPERTY_MEDIA_BUCKET}/${storagePath}`,
    title: optionalString(form.get('title')),
    description: optionalString(form.get('description')),
    sortOrder: Number.isFinite(sortOrderValue) ? sortOrderValue : undefined,
    isCover: form.get('isCover') === 'true' ? true : undefined,
  };
}

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

  try {
    const contentType = req.headers.get('content-type') ?? '';
    const input = contentType.includes('multipart/form-data')
      ? await mediaInputFromForm(req, params.id)
      : parseCreateMediaInput(await readJsonObject(req));
    if (!input) {
      return NextResponse.json({ ok: false, error: 'url_or_storage_path_required' }, { status: 400 });
    }

    const item = await addPropertyMedia(auth.ctx, params.id, input);
    return NextResponse.json({ ok: true, media: item }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'property_not_found') {
      return NextResponse.json({ ok: false, error: 'property_not_found' }, { status: 404 });
    }
    if (err instanceof Error && err.message === 'image_file_required') {
      return NextResponse.json({ ok: false, error: 'image_file_required' }, { status: 400 });
    }
    if (err instanceof Error && err.message === 'image_too_large') {
      return NextResponse.json({ ok: false, error: 'image_too_large' }, { status: 413 });
    }
    return opsFoundationApiErrorResponse(err);
  }
}
