import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import { getEngineProgressSnapshot } from '@/lib/engine-progress/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read-only owner-only status. Does not stage, run, merge, or activate anything. */
export async function GET() {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;
  try {
    const snapshot = await getEngineProgressSnapshot();
    return NextResponse.json({ ok: true, ...snapshot }, {
      headers: { 'cache-control': 'private, no-store, max-age=0', 'x-content-type-options': 'nosniff' },
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить вехи. Данные не подтверждены.' }, {
      status: 503, headers: { 'cache-control': 'private, no-store, max-age=0' },
    });
  }
}
