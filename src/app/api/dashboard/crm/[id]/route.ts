import { NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { readRequestJson } from '@/lib/safeRequestJson';
import { normalizeCrmContactInput } from '@/lib/crm/normalize';
import { updateCrmContact } from '@/lib/crm/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireDashboardSession(): Promise<NextResponse | null> {
  if (!isSessionSecretConfigured()) {
    return NextResponse.json({ ok: false, message: 'Доступ к CRM не настроен.' }, { status: 401 });
  }
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ ok: false, message: 'Войдите, чтобы открыть CRM.' }, { status: 401 });
  }
  return null;
}

export async function PATCH(req: Request, context: { params: { id: string } }): Promise<NextResponse> {
  const authError = await requireDashboardSession();
  if (authError) return authError;

  const id = context.params.id?.trim();
  if (!id) {
    return NextResponse.json({ ok: false, message: 'Лид не найден.' }, { status: 404 });
  }

  const body = await readRequestJson(req);
  if (!body.ok) {
    return NextResponse.json({ ok: false, message: 'Проверьте данные лида.' }, { status: 400 });
  }

  const raw = body.data;
  const normalized = normalizeCrmContactInput(raw);
  const patch: Partial<typeof normalized> = {};
  for (const key of Object.keys(raw) as Array<keyof typeof normalized>) {
    if (key in normalized) patch[key] = normalized[key] as never;
  }

  try {
    const contact = await updateCrmContact(id, patch);
    return NextResponse.json({ ok: true, contact });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось сохранить изменения.' }, { status: 500 });
  }
}
