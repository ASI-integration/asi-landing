import { NextResponse } from 'next/server';
import { readRequestJson } from '@/lib/safeRequestJson';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getCrmContactById, updateCrmContact } from '@/lib/crm/repository';
import { buildOperatorActionPatch, listOpsPilotParticipants } from '@/lib/ops-pilot/service';
import { buildOpsPilotParticipantSnapshot } from '@/lib/ops-pilot/snapshot';
import type { OpsPilotOperatorAction } from '@/lib/ops-pilot/types';
import { listOpsOperatorTasks } from '@/lib/ops-board/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPERATOR_ACTIONS = new Set<OpsPilotOperatorAction>([
  'mark_manual_control',
  'mark_waiting_owner',
  'add_note',
]);

export async function GET(): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  try {
    const { participants } = await listOpsPilotParticipants();
    return NextResponse.json({
      ok: true,
      participants,
      refreshedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить пилотных участников.' }, { status: 500 });
  }
}

export async function PATCH(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const body = await readRequestJson(req);
  if (!body.ok) {
    return NextResponse.json({ ok: false, message: 'Некорректный запрос.' }, { status: 400 });
  }

  const raw = body.data;
  const contactId = String(raw.contactId ?? '').trim();
  const action = String(raw.action ?? '').trim() as OpsPilotOperatorAction;

  if (!contactId) {
    return NextResponse.json({ ok: false, message: 'Укажите участника.' }, { status: 400 });
  }
  if (!OPERATOR_ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, message: 'Неизвестное действие.' }, { status: 400 });
  }

  const existing = await getCrmContactById(contactId);
  if (!existing) {
    return NextResponse.json({ ok: false, message: 'Участник не найден.' }, { status: 404 });
  }

  const patch = buildOperatorActionPatch(action, typeof raw.note === 'string' ? raw.note : null);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, message: 'Нечего сохранить.' }, { status: 400 });
  }

  try {
    const contact = await updateCrmContact(contactId, patch);
    const opsResult = await listOpsOperatorTasks({ status: 'all' });
    const opsTasks = opsResult.ok ? opsResult.tasks : [];
    const participant = buildOpsPilotParticipantSnapshot(contact, opsTasks);
    return NextResponse.json({ ok: true, participant });
  } catch {
    return NextResponse.json({ ok: false, message: 'Не удалось сохранить действие.' }, { status: 500 });
  }
}
