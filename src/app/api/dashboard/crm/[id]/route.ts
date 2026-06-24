import { NextResponse } from 'next/server';
import { readRequestJson } from '@/lib/safeRequestJson';
import { normalizeCrmContactInput } from '@/lib/crm/normalize';
import { deleteCrmContact, listCrmContacts, updateCrmContact } from '@/lib/crm/repository';
import { validatePilotStatusChange } from '@/lib/crm/pilot-rollout';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, context: { params: { id: string } }): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

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

  if (patch.status) {
    const contacts = await listCrmContacts();
    const limitError = validatePilotStatusChange(contacts, id, patch.status);
    if (limitError) {
      return NextResponse.json({ ok: false, message: limitError }, { status: 409 });
    }
  }

  try {
    const contact = await updateCrmContact(id, patch);
    return NextResponse.json({ ok: true, contact });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось сохранить изменения.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: { params: { id: string } }): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const id = context.params.id?.trim();
  if (!id) {
    return NextResponse.json({ ok: false, message: 'Лид не найден.' }, { status: 404 });
  }

  try {
    await deleteCrmContact(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось удалить лида.' }, { status: 500 });
  }
}
