import { NextRequest, NextResponse } from 'next/server';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { isDashboardInternalUser } from '@/lib/dashboard/internal-access';
import {
  answersJsonWithAdminNote,
  answersJsonWithSupportStatus,
  isCrmLeadStatus,
  isSupportRequestStatus,
  normalizeLeadRow,
  type LeadDbRow,
  type LeadViewModel,
} from '@/lib/dashboard/leads';
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
    const leads = ((data ?? []) as LeadDbRow[]).map(normalizeLeadRow);
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

  if (status !== undefined && !isCrmLeadStatus(status)) {
    return jsonError('Некорректный статус заявки', 400);
  }
  if (supportStatus !== undefined && !isSupportRequestStatus(supportStatus)) {
    return jsonError('Некорректный статус вопроса поддержки', 400);
  }
  if (adminNote !== undefined && typeof adminNote !== 'string') {
    return jsonError('Заметка должна быть строкой', 400);
  }

  try {
    const current = await fetchLeadById(leadId);
    if (!current) return jsonError('Заявка не найдена', 404);

    let answersJson = current.answers_json;
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

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (status !== undefined) patch.status = status;
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
