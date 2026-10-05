import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { requireBookingOpsApiAutoSendScopeAccess } from '../../../../access';
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
    return NextResponse.json({ ok: false, message: 'Укажите ограниченный уровень.' }, { status: 400 });
  }
  const scopeRef = String(body.scopeRef ?? body.scope_ref ?? '').trim();
  const access = await requireBookingOpsApiAutoSendScopeAccess(auth.session, scopeType, scopeRef);
  if (!access.ok) return access.response;
  const result = await setAutoSendScope({
    accountId: access.accountId,
    scopeType,
    scopeRef,
    enabled: false,
    enabledBy: String(auth.session.email ?? auth.session.userId ?? 'ops-admin'),
    reason: typeof body.reason === 'string' ? body.reason : 'Отключено оператором.',
    maxBatchSize: body.maxBatchSize ?? body.max_batch_size,
    allowedChannels: body.allowedChannels ?? body.allowed_channels,
    allowedMessageTypes: body.allowedMessageTypes ?? body.allowed_message_types,
    dryRunOnly: true,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: 'Не удалось отключить автоотправку.', reason: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: 'Автоотправка для уровня отключена.', scope: result.scope });
}
