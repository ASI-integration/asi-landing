import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import { getEngineProgressSnapshot } from '@/lib/engine-progress/server';
import { getStrigunovProgress } from '@/lib/engine-progress/strigunov-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Read-only owner-only status. Does not stage, run, merge, or activate anything. */
export async function GET(request?: Request) {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;
  try {
    const pilot = request && new URL(request.url).searchParams.get('view') === 'strigunov4';
    const snapshot = await (pilot ? getStrigunovProgress() : getEngineProgressSnapshot());
    return NextResponse.json({ ok: true, ...snapshot }, {
      headers: { 'cache-control': 'private, no-store, max-age=0', 'x-content-type-options': 'nosniff' },
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить вехи. Данные не подтверждены.' }, {
      status: 503, headers: { 'cache-control': 'private, no-store, max-age=0' },
    });
  }
}
