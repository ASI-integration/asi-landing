import { NextRequest, NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { isDashboardInternalUser } from '@/lib/dashboard/internal-access';
import {
  applyPilotCrmDecision,
  createCrmContact,
  listCrmContacts,
  listCrmPropertyOptions,
  updateCrmContact,
  type PilotCrmDecision,
} from '@/lib/crm/repository';
import { isCrmRole, isCrmSource, isCrmStatus, matchesCrmFilter } from '@/lib/crm/view-model';
import type { CrmFilter } from '@/lib/crm/types';

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

const VALID_FILTERS = new Set<CrmFilter>([
  'all',
  'new',
  'needs_reaction',
  'pilot_candidates',
  'pilot_selected',
  'testing',
  'pilot_active',
  'escalations',
]);

const PILOT_DECISIONS = new Set<PilotCrmDecision>(['select', 'waitlist', 'not_fit']);

export async function GET(req: NextRequest) {
  const auth = await requireInternalSession();
  if (!auth.ok) return jsonError(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const rawLimit = Number(searchParams.get('limit') ?? 250);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 250) : 250;
  const filterParam = (searchParams.get('filter') ?? 'all') as CrmFilter;
  const filter = VALID_FILTERS.has(filterParam) ? filterParam : 'all';

  try {
    const [contacts, propertyOptions] = await Promise.all([
      listCrmContacts(limit),
      listCrmPropertyOptions(),
    ]);
    const filtered = filter === 'all' ? contacts : contacts.filter((contact) => matchesCrmFilter(contact, filter));
    const needsReaction = contacts.filter((contact) => contact.needsReaction);

    return NextResponse.json({
      ok: true,
      contacts: filtered,
      needsReaction,
      propertyOptions,
      total: contacts.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[dashboard/crm] GET failed', { error: message });
    return jsonError('Не удалось загрузить CRM', 500);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireInternalSession();
  if (!auth.ok) return jsonError(auth.error, auth.status);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError('Некорректный JSON', 400);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const role = typeof body.role === 'string' ? body.role : '';
  if (!name) return jsonError('Укажите имя', 400);
  if (!isCrmRole(role)) return jsonError('Некорректная роль', 400);

  const source = typeof body.source === 'string' && isCrmSource(body.source) ? body.source : 'manual';
  const status = typeof body.status === 'string' && isCrmStatus(body.status) ? body.status : 'new';
  const contact = typeof body.contact === 'string' ? body.contact.trim() : null;
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  const nextAction = typeof body.nextAction === 'string' ? body.nextAction.trim() : '';
  const propertyId = typeof body.propertyId === 'string' ? body.propertyId.trim() : null;

  try {
    const created = await createCrmContact({
      name,
      role,
      source,
      status,
      contact,
      notes,
      nextAction,
      propertyId,
    });
    return NextResponse.json({ ok: true, contact: created });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[dashboard/crm] POST failed', { error: message });
    return jsonError('Не удалось создать запись', 500);
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireInternalSession();
  if (!auth.ok) return jsonError(auth.error, auth.status);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError('Некорректный JSON', 400);
  }

  const contactId = typeof body.id === 'string' ? body.id.trim() : '';
  if (!contactId) return jsonError('Не указан id записи', 400);

  if (typeof body.pilotDecision === 'string') {
    if (!PILOT_DECISIONS.has(body.pilotDecision as PilotCrmDecision)) {
      return jsonError('Некорректное действие по пилоту', 400);
    }
    try {
      const updated = await applyPilotCrmDecision(contactId, body.pilotDecision as PilotCrmDecision);
      if (!updated) return jsonError('Запись не найдена', 404);
      return NextResponse.json({ ok: true, contact: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[dashboard/crm] pilot decision failed', { error: message, id: contactId });
      return jsonError('Не удалось обновить решение по пилоту', 500);
    }
  }

  const patch: Parameters<typeof updateCrmContact>[1] = {};
  if (typeof body.status === 'string') {
    if (!isCrmStatus(body.status)) return jsonError('Некорректный статус', 400);
    patch.status = body.status;
  }
  if (typeof body.notes === 'string') patch.notes = body.notes;
  if (typeof body.nextAction === 'string') patch.nextAction = body.nextAction;
  if (body.nextActionDueAt === null || typeof body.nextActionDueAt === 'string') {
    patch.nextActionDueAt = body.nextActionDueAt as string | null;
  }
  if (body.propertyId === null || typeof body.propertyId === 'string') {
    patch.propertyId = body.propertyId as string | null;
  }
  if (typeof body.propertyCount === 'number' && Number.isFinite(body.propertyCount)) {
    patch.propertyCount = Math.trunc(body.propertyCount);
  }
  if (typeof body.awaitingReply === 'boolean') patch.awaitingReply = body.awaitingReply;

  if (Object.keys(patch).length === 0) return jsonError('Нет полей для обновления', 400);

  try {
    const updated = await updateCrmContact(contactId, patch);
    if (!updated) return jsonError('Запись не найдена', 404);
    return NextResponse.json({ ok: true, contact: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[dashboard/crm] PATCH failed', { error: message });
    return jsonError('Не удалось обновить запись', 500);
  }
}
