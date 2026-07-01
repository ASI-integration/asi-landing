import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  AUTO_SEND_SCOPE_TYPES,
  setAutoSendScope,
  type AutoSendScopeType,
} from '@/lib/booking-ops/communication-auto-send-scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }
  const scopeType = String(body.scopeType ?? body.scope_type ?? '') as AutoSendScopeType;
  if (!AUTO_SEND_SCOPE_TYPES.includes(scopeType) || scopeType === 'global') {
    return NextResponse.json({ ok: false, message: 'Можно включить только ограниченный уровень.' }, { status: 400 });
  }
  const result = await setAutoSendScope({
    scopeType,
    scopeRef: String(body.scopeRef ?? body.scope_ref ?? '').trim(),
    enabled: true,
    enabledBy: String(auth.session.email ?? auth.session.userId ?? 'ops-admin'),
    reason: typeof body.reason === 'string' ? body.reason : null,
    maxBatchSize: body.maxBatchSize ?? body.max_batch_size,
    allowedChannels: body.allowedChannels ?? body.allowed_channels,
    allowedMessageTypes: body.allowedMessageTypes ?? body.allowed_message_types,
    dryRunOnly: body.dryRunOnly === true || body.dry_run_only === true,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: 'Не удалось включить ограниченную автоотправку.', reason: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: 'Ограниченная автоотправка включена.', scope: result.scope });
}
