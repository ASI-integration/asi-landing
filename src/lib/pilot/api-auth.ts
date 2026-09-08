import { NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { isPilotBetaEmail, PILOT_BETA_ROLE } from './access';

export async function requirePilotBetaSession(): Promise<
  | { error: NextResponse }
  | { session: Awaited<ReturnType<typeof getSession>>; role: typeof PILOT_BETA_ROLE }
> {
  if (!isSessionSecretConfigured()) {
    return {
      error: NextResponse.json(
        { ok: false, message: 'Пилот ASI недоступен.' },
        { status: 401, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  const session = await getSession();
  if (!session.userId) {
    return {
      error: NextResponse.json(
        { ok: false, message: 'Войдите, чтобы открыть пилот ASI.' },
        { status: 401, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  if (!isPilotBetaEmail(session.email)) {
    return {
      error: NextResponse.json(
        { ok: false, message: 'Нет доступа к пилоту ASI. Нужно приглашение.' },
        { status: 403, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  return { session, role: PILOT_BETA_ROLE };
}
