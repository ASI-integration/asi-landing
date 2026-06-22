import { NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { isCrmOperatorEmail } from './access';

export async function requireCrmOperatorSession(): Promise<
  | { error: NextResponse }
  | { session: Awaited<ReturnType<typeof getSession>> }
> {
  if (!isSessionSecretConfigured()) {
    return {
      error: NextResponse.json({ ok: false, message: 'Доступ к CRM не настроен.' }, { status: 401 }),
    };
  }

  const session = await getSession();
  if (!session.userId) {
    return {
      error: NextResponse.json({ ok: false, message: 'Войдите, чтобы открыть CRM.' }, { status: 401 }),
    };
  }

  if (!isCrmOperatorEmail(session.email)) {
    return {
      error: NextResponse.json({ ok: false, message: 'Нет доступа к CRM.' }, { status: 403 }),
    };
  }

  return { session };
}
