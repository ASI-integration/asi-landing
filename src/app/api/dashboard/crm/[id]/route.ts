import { NextResponse } from 'next/server';
import { readRequestJson } from '@/lib/safeRequestJson';
import { normalizeCrmContactInput, validateCrmContactPayload } from '@/lib/crm/normalize';
import {
  CrmContactNotFoundError,
  deleteCrmContact,
  listCrmContacts,
  updateCrmContact,
} from '@/lib/crm/repository';
import { validatePilotStatusChange } from '@/lib/crm/pilot-rollout';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { resolvePilotChainNextActions } from '@/lib/pilot-chain/next-actions';
import { runPilotChainForContact } from '@/lib/pilot-chain/orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, context: { params: { id: string } }): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const id = context.params.id?.trim();
  if (!id) {
    return NextResponse.json({ ok: false, message: 'Заявка не найдена.' }, { status: 404 });
  }

  const body = await readRequestJson(req);
  if (!body.ok) {
    return NextResponse.json({ ok: false, message: 'Проверьте данные заявки.' }, { status: 400 });
  }

  const raw = body.data;
  const payloadError = validateCrmContactPayload(raw, true);
  if (payloadError) {
    return NextResponse.json({ ok: false, message: payloadError }, { status: 400 });
  }
  const normalized = normalizeCrmContactInput(raw);
  const patch: Partial<typeof normalized> = {};
  for (const key of Object.keys(raw) as Array<keyof typeof normalized>) {
    if (key in normalized) patch[key] = normalized[key] as never;
  }

  let contact: Awaited<ReturnType<typeof updateCrmContact>>;
  try {
    if (patch.status) {
      const contacts = await listCrmContacts();
      const limitError = validatePilotStatusChange(contacts, id, patch.status);
      if (limitError) {
        return NextResponse.json({ ok: false, message: limitError }, { status: 409 });
      }
    }
    contact = await updateCrmContact(id, patch);
  } catch (error) {
    if (error instanceof CrmContactNotFoundError) {
      return NextResponse.json({ ok: false, message: 'Заявка не найдена.' }, { status: 404 });
    }
    return NextResponse.json({ ok: false, message: 'Не удалось сохранить изменения.' }, { status: 500 });
  }

  try {
    const chain = await runPilotChainForContact(id);
    const resolvedContact = chain.contact ?? contact;
    const nextActions = resolvePilotChainNextActions(resolvedContact, {
      opsTaskId: chain.opsTaskId,
    });
    return NextResponse.json({
      ok: true,
      contact: resolvedContact,
      pilotChain: {
        objectId: chain.objectId,
        steps: chain.steps,
        opsTaskId: chain.opsTaskId,
        nextActions,
      },
    });
  } catch (error) {
    console.error('[crm] Заявка сохранена, но автоматический следующий шаг не выполнен', { id, error });
    return NextResponse.json({
      ok: true,
      contact,
      warning: 'Изменения сохранены, но следующий автоматический шаг не выполнен. Проверьте заявку вручную.',
    });
  }
}

export async function DELETE(_req: Request, context: { params: { id: string } }): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const id = context.params.id?.trim();
  if (!id) {
    return NextResponse.json({ ok: false, message: 'Заявка не найдена.' }, { status: 404 });
  }

  try {
    await deleteCrmContact(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CrmContactNotFoundError) {
      return NextResponse.json({ ok: false, message: 'Заявка не найдена.' }, { status: 404 });
    }
    return NextResponse.json({ ok: false, message: 'Не удалось удалить заявку.' }, { status: 500 });
  }
}
