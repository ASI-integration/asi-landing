import { NextResponse } from 'next/server';
import { requireCabinetSession } from '@/lib/cabinet/api-auth';
import { assertPublicRuntimeSnapshotSafe, toPublicRuntimeSnapshot } from '@/lib/asi-runtime/public-status';
import { getRuntimeSnapshotForUser } from '@/lib/asi-runtime/repository';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await requireCabinetSession();
  if ('error' in auth) return auth.error;

  try {
    const row = await getRuntimeSnapshotForUser(auth.session.userId);
    if (!row) {
      return NextResponse.json({
        ok: true,
        connected: false,
        message: 'Данные Runtime ещё не поступали',
      });
    }

    const snapshot = toPublicRuntimeSnapshot(row);
    assertPublicRuntimeSnapshotSafe(snapshot);

    return NextResponse.json({
      ok: true,
      connected: true,
      snapshot,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить статус Runtime.' },
      { status: 500 },
    );
  }
}
