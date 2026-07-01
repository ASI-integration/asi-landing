import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { setGlobalAutoSendEmergencyStop } from '@/lib/booking-ops/communication-auto-send-scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ ok: false, message: 'Укажите состояние аварийной остановки.' }, { status: 400 });
  }
  const result = await setGlobalAutoSendEmergencyStop({
    enabled: body.enabled,
    enabledBy: String(auth.session.email ?? auth.session.userId ?? 'ops-admin'),
    reason: typeof body.reason === 'string' ? body.reason : null,
  });
  if (!result.ok) return NextResponse.json({ ok: false, message: 'Не удалось изменить аварийную остановку.' }, { status: 500 });
  return NextResponse.json({
    ok: true,
    emergencyStop: result.scope.emergencyStop,
    message: result.scope.emergencyStop ? 'Все автоматические отправки остановлены.' : 'Аварийная остановка снята.',
  });
}
