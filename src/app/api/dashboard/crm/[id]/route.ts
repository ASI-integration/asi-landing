import { NextRequest, NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { isDashboardInternalUser } from '@/lib/dashboard/internal-access';
import { getCrmContactById } from '@/lib/crm/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireInternalSession() {
  if (!isSessionSecretConfigured()) return { ok: false as const, status: 401, error: 'Unauthorized' };
  const session = await getSession();
  if (!session.userId) return { ok: false as const, status: 401, error: 'Unauthorized' };
  if (!isDashboardInternalUser(session.email)) return { ok: false as const, status: 403, error: 'Forbidden' };
  return { ok: true as const, session };
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireInternalSession();
  if (!auth.ok) return jsonError(auth.error, auth.status);

  try {
    const contact = await getCrmContactById(params.id);
    if (!contact) return jsonError('Запись не найдена', 404);
    return NextResponse.json({ ok: true, contact });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[dashboard/crm/[id]] GET failed', { error: message, id: params.id });
    return jsonError('Не удалось загрузить запись', 500);
  }
}
