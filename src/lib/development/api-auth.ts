import { NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { isDevelopmentOwnerEmail } from './access';

export async function requireDevelopmentOwnerSession(): Promise<
  | { error: NextResponse }
  | { session: Awaited<ReturnType<typeof getSession>> }
> {
  if (!isSessionSecretConfigured()) {
    return {
      error: NextResponse.json(
        { ok: false, message: 'Консоль разработки недоступна.' },
        { status: 401, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  const session = await getSession();
  if (!session.userId) {
    return {
      error: NextResponse.json(
        { ok: false, message: 'Войдите, чтобы открыть консоль разработки.' },
        { status: 401, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  if (!isDevelopmentOwnerEmail(session.email)) {
    return {
      error: NextResponse.json(
        { ok: false, message: 'Нет доступа к консоли разработки ASI.' },
        { status: 403, headers: { 'cache-control': 'no-store' } },
      ),
    };
  }

  return { session };
}
