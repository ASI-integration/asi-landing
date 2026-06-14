import { NextRequest, NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { isDashboardInternalUser } from '@/lib/dashboard/internal-access';
import {
  answersJsonWithAdminNote,
  answersJsonWithChannelManagerOnboarding,
  answersJsonWithCrmStatusAction,
  answersJsonWithSupportStatus,
  isCrmLeadStatus,
  isSupportRequestStatus,
  normalizeLeadRow,
  type LeadDbRow,
  type LeadViewModel,
} from '@/lib/dashboard/leads';
import {
  crmStatusForOnboarding,
  ensureChannelManagerOnboarding,
  isChannelManagerOnboardingStatus,
} from '@/lib/leads/channel-manager-onboarding';
import { supabase } from '@/lib/supabase';

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

async function fetchLeadById(leadId: string): Promise<LeadDbRow | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('id, telegram_user_id, telegram_username, first_name, source, answers_json, status, created_at, updated_at')
    .eq('id', leadId)
    .maybeSingle();

  if (error) throw error;
  return (data as LeadDbRow | null) ?? null;
}

async function ensurePersistedOnboarding(row: LeadDbRow): Promise<LeadDbRow> {
  const nextAnswers = ensureChannelManagerOnboarding({
    answers: row.answers_json,
    leadStatus: row.status,
  });
  if (!nextAnswers || JSON.stringify(nextAnswers) === JSON.stringify(row.answers_json ?? {})) return row;

  const { data, error } = await supabase
    .from('leads')
    .update({ answers_json: nextAnswers, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .select('id, telegram_user_id, telegram_username, first_name, source, answers_json, status, created_at, updated_at')
    .single();

  if (error) throw error;
  return data as LeadDbRow;
}

export async function GET(req: NextRequest) {
  const auth = await requireInternalSession();
  if (!auth.ok) return jsonError(auth.error, auth.status);

  const { searchParams } = new URL(req.url);
  const rawLimit = Number(searchParams.get('limit') ?? 200);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 250) : 200;

  try {
    const { data, error } = await supabase
      .from('leads')
      .select('id, telegram_user_id, telegram_username, first_name, source, answers_json, status, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    const rows = await Promise.all(((data ?? []) as LeadDbRow[]).map(ensurePersistedOnboarding));
    const leads = rows.map(normalizeLeadRow);
    const supportRequests = leads.flatMap((lead) => lead.supportRequests);
    return NextResponse.json({ ok: true, leads, supportRequests });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[dashboard/leads] GET failed', { error: message });
    return jsonError('Не удалось загрузить заявки', 500);
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

  const leadId = typeof body.leadId === 'string' ? body.leadId.trim() : '';
  if (!leadId) return jsonError('leadId обязателен', 400);

  const status = body.status;
  const adminNote = body.adminNote;
  const supportStatus = body.supportStatus;
  const supportRequestIndex = body.supportRequestIndex;
  const onboardingStatus = body.onboardingStatus;
  const onboardingAdminNote = body.onboardingAdminNote;
  const onboardingTestObject = body.onboardingTestObject;

  if (status !== undefined && !isCrmLeadStatus(status)) {
    return jsonError('Некорректный статус заявки', 400);
  }
  if (supportStatus !== undefined && !isSupportRequestStatus(supportStatus)) {
    return jsonError('Некорректный статус вопроса поддержки', 400);
  }
  if (adminNote !== undefined && typeof adminNote !== 'string') {
    return jsonError('Заметка должна быть строкой', 400);
  }
  if (onboardingStatus !== undefined && !isChannelManagerOnboardingStatus(onboardingStatus)) {
    return jsonError('Некорректный статус подключения менеджера каналов', 400);
  }
  if (onboardingAdminNote !== undefined && typeof onboardingAdminNote !== 'string') {
    return jsonError('Заметка подключения должна быть строкой', 400);
  }
  if (onboardingTestObject !== undefined && (typeof onboardingTestObject !== 'object' || onboardingTestObject === null || Array.isArray(onboardingTestObject))) {
    return jsonError('Тестовый объект должен быть объектом', 400);
  }

  try {
    const current = await fetchLeadById(leadId);
    if (!current) return jsonError('Заявка не найдена', 404);

    let answersJson = current.answers_json;
    const now = new Date().toISOString();
    if (typeof adminNote === 'string') {
      answersJson = answersJsonWithAdminNote(answersJson, adminNote.slice(0, 4000));
    }
    if (supportStatus !== undefined) {
      const index = typeof supportRequestIndex === 'number'
        ? supportRequestIndex
        : Number(supportRequestIndex);
      const nextAnswersJson = answersJsonWithSupportStatus(answersJson, index, supportStatus);
      if (!nextAnswersJson) return jsonError('Вопрос поддержки не найден', 400);
      answersJson = nextAnswersJson;
    }
    if (onboardingStatus !== undefined || onboardingAdminNote !== undefined || onboardingTestObject !== undefined) {
      const testObject = typeof onboardingTestObject === 'object' && onboardingTestObject !== null && !Array.isArray(onboardingTestObject)
        ? {
            name: typeof (onboardingTestObject as Record<string, unknown>).name === 'string'
              ? ((onboardingTestObject as Record<string, unknown>).name as string).slice(0, 240).trim() || null
              : undefined,
            external_id: typeof (onboardingTestObject as Record<string, unknown>).external_id === 'string'
              ? ((onboardingTestObject as Record<string, unknown>).external_id as string).slice(0, 160).trim() || null
              : undefined,
            notes: typeof (onboardingTestObject as Record<string, unknown>).notes === 'string'
              ? ((onboardingTestObject as Record<string, unknown>).notes as string).slice(0, 1000).trim() || null
              : undefined,
          }
        : undefined;
      answersJson = answersJsonWithChannelManagerOnboarding(answersJson, {
        status: onboardingStatus,
        adminNote: typeof onboardingAdminNote === 'string' ? onboardingAdminNote.slice(0, 4000) : undefined,
        testObject,
        now,
      });
    }

    const patch: Record<string, unknown> = {
      updated_at: now,
    };
    const onboardingCrmStatus = onboardingStatus ? crmStatusForOnboarding(onboardingStatus) : null;
    const nextStatus = status !== undefined
      ? status
      : onboardingCrmStatus && isCrmLeadStatus(onboardingCrmStatus)
        ? onboardingCrmStatus
        : null;
    if (nextStatus) {
      patch.status = nextStatus;
      answersJson = answersJsonWithCrmStatusAction(answersJson, nextStatus, now);
    }
    if (answersJson !== current.answers_json) patch.answers_json = answersJson;

    const { data, error } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', leadId)
      .select('id, telegram_user_id, telegram_username, first_name, source, answers_json, status, created_at, updated_at')
      .single();

    if (error) throw error;
    const lead: LeadViewModel = normalizeLeadRow(data as LeadDbRow);
    return NextResponse.json({ ok: true, lead });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[dashboard/leads] PATCH failed', { leadId, error: message });
    return jsonError('Не удалось сохранить изменения', 500);
  }
}
