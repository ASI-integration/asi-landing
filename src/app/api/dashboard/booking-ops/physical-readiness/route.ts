import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  approveFinalPhysicalReadiness,
  createMaintenanceTicket,
  createPhysicalCoordinationDraft,
  ensurePhysicalTasks,
  getPhysicalReadiness,
  recomputePhysicalReadiness,
  updateCleaningTask,
  updateLinenTask,
  updateMaintenanceTicket,
  updateSuppliesTask,
} from '@/lib/booking-ops/physical-readiness-execution';
import { emitPhysicalLifecycle } from '@/lib/booking-ops/lifecycle-entry-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = new Set([
  'ensure_tasks', 'recompute', 'update_cleaning', 'update_linen', 'update_supplies',
  'create_maintenance', 'update_maintenance', 'create_draft', 'final_approval',
]);
function text(value: unknown): string { return String(value ?? '').trim(); }

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const bookingId = text(new URL(req.url).searchParams.get('bookingId'));
  try {
    const readiness = await getPhysicalReadiness(bookingId);
    return NextResponse.json({ ok: true, readiness });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось получить физическую готовность.' }, { status: 400 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 }); }
  const bookingId = text(body.bookingId ?? body.booking_id);
  const action = text(body.action);
  if (!ACTIONS.has(action)) return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
  try {
    const readiness = await runAction(action, bookingId, body, auth.session.email ?? 'Оператор');
    await emitPhysicalLifecycle({ bookingId, action, actorId: auth.session.email ?? auth.session.userId ?? null, body });
    return NextResponse.json({ ok: true, readiness });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Действие не выполнено.' }, { status: 400 });
  }
}

function runAction(action: string, bookingId: string, body: Record<string, unknown>, operator: string) {
  switch (action) {
    case 'ensure_tasks': return ensurePhysicalTasks(bookingId);
    case 'recompute': return recomputePhysicalReadiness(bookingId);
    case 'update_cleaning': return updateCleaningTask(bookingId, body);
    case 'update_linen': return updateLinenTask(bookingId, body);
    case 'update_supplies': return updateSuppliesTask(bookingId, body);
    case 'create_maintenance': return createMaintenanceTicket(bookingId, body);
    case 'update_maintenance': return updateMaintenanceTicket(bookingId, body);
    case 'create_draft': return createPhysicalCoordinationDraft(bookingId, { ...body, createdBy: operator });
    case 'final_approval': return approveFinalPhysicalReadiness(bookingId, operator);
    default: return Promise.reject(new Error('action_invalid'));
  }
}
