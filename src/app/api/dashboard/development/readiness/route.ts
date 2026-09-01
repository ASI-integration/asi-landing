import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import { getDevelopmentReadiness } from '@/lib/development/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request?: Request) {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;

  const repositoryId = request
    ? new URL(request.url).searchParams.get('repositoryId')
    : null;

  try {
    const readiness = await getDevelopmentReadiness({ repositoryId });
    return NextResponse.json(
      { ok: true, readiness },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    console.warn('[development-readiness] bounded check failed');
    return NextResponse.json(
      { ok: false, message: 'Не удалось проверить готовность. Повторите попытку.' },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
