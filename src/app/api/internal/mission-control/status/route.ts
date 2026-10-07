import { NextResponse } from 'next/server';
import { isRuntimeIngestAuthorized } from '@/lib/asi-runtime/ingest-auth';
import {
  parseMissionControlStatusPayload,
  readMissionControlStatusBody,
} from '@/lib/mission-control/schema';
import { saveMissionControlStatus } from '@/lib/mission-control/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

function isInternalTestAuthorized(request: Request): boolean {
  const expected = process.env.INTERNAL_TEST_SECRET?.trim();
  if (!expected) return false;
  return request.headers.get('x-internal-test-secret') === expected;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isRuntimeIngestAuthorized(request) && !isInternalTestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, message: 'Доступ запрещён.' },
      { status: 401, headers: NO_STORE },
    );
  }

  const body = await readMissionControlStatusBody(request);
  const payload = parseMissionControlStatusPayload(body);
  if (!payload) {
    return NextResponse.json(
      { ok: false, message: 'Некорректный статус проекта.' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const stored = await saveMissionControlStatus(payload);
    return NextResponse.json(
      {
        ok: true,
        projectId: stored.projectId,
        receivedAt: stored.receivedAt,
      },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Не удалось сохранить статус проекта.' },
      { status: 500, headers: NO_STORE },
    );
  }
}
