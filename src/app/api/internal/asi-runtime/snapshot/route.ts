import { NextResponse } from 'next/server';
import { getRuntimeOwnerUserId, isRuntimeIngestAuthorized } from '@/lib/asi-runtime/ingest-auth';
import { parseRuntimeSnapshotIngestPayload, readRuntimeSnapshotIngestBody } from '@/lib/asi-runtime/ingest-schema';
import { upsertRuntimeSnapshot } from '@/lib/asi-runtime/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AUTH_ERROR = { ok: false, message: 'Доступ запрещён.' } as const;
const VALIDATION_ERROR = { ok: false, message: 'Некорректный Runtime snapshot.' } as const;

export async function POST(request: Request): Promise<NextResponse> {
  if (!isRuntimeIngestAuthorized(request)) {
    return NextResponse.json(AUTH_ERROR, { status: 401 });
  }

  const ownerUserId = getRuntimeOwnerUserId();
  if (!ownerUserId) {
    return NextResponse.json(AUTH_ERROR, { status: 403 });
  }

  const body = await readRuntimeSnapshotIngestBody(request);
  if (body === null) {
    return NextResponse.json(VALIDATION_ERROR, { status: 400 });
  }

  const payload = parseRuntimeSnapshotIngestPayload(body);
  if (!payload) {
    return NextResponse.json(VALIDATION_ERROR, { status: 400 });
  }

  try {
    const row = await upsertRuntimeSnapshot({
      ...payload,
      userId: ownerUserId,
    });

    return NextResponse.json({
      ok: true,
      taskId: row.task_id,
      updatedAt: row.updated_at,
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Не удалось сохранить Runtime snapshot.' },
      { status: 500 },
    );
  }
}
