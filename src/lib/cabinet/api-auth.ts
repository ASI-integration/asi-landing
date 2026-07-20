import { NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';

export async function requireCabinetSession(): Promise<
  | { error: NextResponse }
  | { session: Awaited<ReturnType<typeof getSession>> }
> {
  if (!isSessionSecretConfigured()) {
    return {
      error: NextResponse.json({ ok: false, message: 'Войдите, чтобы открыть личный кабинет.' }, { status: 401 }),
    };
  }

  const session = await getSession();
  if (!session.userId) {
    return {
      error: NextResponse.json({ ok: false, message: 'Войдите, чтобы открыть личный кабинет.' }, { status: 401 }),
    };
  }

  return { session };
}
