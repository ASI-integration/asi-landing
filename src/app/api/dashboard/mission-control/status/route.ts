import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import { getMissionControlDashboard } from '@/lib/mission-control/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(): Promise<NextResponse> {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;

  try {
    const projects = await getMissionControlDashboard();
    return NextResponse.json(
      {
        ok: true,
        projects,
        fetchedAt: new Date().toISOString(),
      },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Не удалось загрузить статусы проектов.' },
      { status: 500, headers: NO_STORE },
    );
  }
}
