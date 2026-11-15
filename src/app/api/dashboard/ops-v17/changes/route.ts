import { NextResponse } from 'next/server';
import { requireCabinetSession } from '@/lib/cabinet/api-auth';
import { resolveOwnerAccountIdForUser } from '@/lib/accounts';
import { supabase } from '@/lib/supabase';
import { parseOwnerChange } from '@/lib/ops-v17/change-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function owner() {
  const auth = await requireCabinetSession();
  if ('error' in auth) return auth;
  const accountId = await resolveOwnerAccountIdForUser(auth.session.userId!);
  if (!accountId || accountId === 'legacy') {
    return { error: NextResponse.json({ ok: false, message: 'Нет доступа к рабочему пространству.' }, { status: 403 }) };
  }
  return { accountId, actorId: auth.session.userId! };
}

export async function GET() {
  const auth = await owner();
  if ('error' in auth) return auth.error;
  const { data, error } = await supabase.from('ops_v17_owner_change_receipts')
    .select('id,section,status,external_status,explanation,created_at,applied_at,confirmed_at,requested_values,before_values,applied_values')
    .eq('account_id', auth.accountId)
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) return NextResponse.json({ ok: false, message: 'История изменений недоступна.' }, { status: 503 });
  // Report field names only; keep before/after values (including owner contacts) server-side.
  const changes = (data ?? []).map((record) => {
    const requested = (record.requested_values ?? {}) as Record<string, unknown>;
    const before = (record.before_values ?? {}) as Record<string, unknown>;
    const applied = (record.applied_values ?? {}) as Record<string, unknown>;
    const fields = Object.keys(requested).filter((key) =>
      record.status === 'conflict' || JSON.stringify(before[key] ?? null) !== JSON.stringify(applied[key] ?? null));
    const { requested_values: _req, before_values: _before, applied_values: _applied, ...publicSummary } = record;
    return { ...publicSummary, fields };
  });
  return NextResponse.json({ ok: true, changes }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function POST(req: Request) {
  const auth = await owner();
  if ('error' in auth) return auth.error;
  let change: ReturnType<typeof parseOwnerChange>;
  try {
    if (Number(req.headers.get('content-length') || '0') > 14000) {
      return NextResponse.json({ ok: false, message: 'Запрос слишком большой.' }, { status: 413 });
    }
    change = parseOwnerChange(await req.json());
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : 'Не удалось прочитать запрос.',
    }, { status: 400 });
  }

  // The role key and account selector never originate in the request body.
  // A single Postgres transaction locks the canonical owner onboarding row,
  // checks its expected revision, applies the safe internal change, records
  // audit evidence, and confirms a read-back. No outbound side effects.
  const { data, error } = await supabase.rpc('apply_ops_v17_owner_change', {
    p_account_id: auth.accountId,
    p_actor_id: auth.actorId,
    p_request_id: change.requestId,
    p_section: change.section,
    p_values: change.values,
    p_expected: change.expected,
  });
  if (error || !data || typeof data !== 'object') {
    return NextResponse.json({
      ok: false, message: 'Изменение не применено. Проверьте доступность журнала и повторите позже.',
    }, { status: 503 });
  }
  const result = data as { status?: string; requestId?: string; externalStatus?: string; explanation?: string };
  if (result.status === 'conflict' || result.status === 'setup_required') {
    return NextResponse.json({ ok: false, result, message: result.explanation || 'Обновите данные и повторите запрос.' }, { status: 409 });
  }
  if (result.status !== 'applied_internal') {
    return NextResponse.json({ ok: false, message: 'Не удалось подтвердить применение.' }, { status: 503 });
  }
  return NextResponse.json({ ok: true, result }, { headers: { 'Cache-Control': 'private, no-store' } });
}
