import { NextResponse } from 'next/server';
import { requireBookingOpsApiAccess } from '../../access';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { issueWorkerTaskLink, listWorkerTasks, revokeWorkerTaskLink } from '@/lib/booking-ops/secure-worker-links';
import type { WorkerTaskRole } from '@/lib/booking-ops/lifecycle-autopilot';

const ROLES = new Set(['cleaner', 'linen_worker', 'consumables', 'inspector', 'maintenance_technician']);
type Context = { params: { id: string } };

export async function GET(_request: Request, context: Context) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
  return NextResponse.json({ ok: true, tasks: await listWorkerTasks(access.bookingId, expectedScope) });
}

export async function POST(request: Request, context: Context) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const role = String(body.role ?? '');
  if (!ROLES.has(role)) return NextResponse.json({ ok: false, message: 'Выберите допустимую роль.' }, { status: 400 });
  const expiresAt = String(body.expiresAt ?? '');
  if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) return NextResponse.json({ ok: false, message: 'Укажите срок действия ссылки.' }, { status: 400 });
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
  try {
    const issued = await issueWorkerTaskLink({ bookingId: access.bookingId, taskId: String(body.taskId ?? ''), role: role as WorkerTaskRole, personId: body.personId ? String(body.personId) : null, expiresAt, actorId: auth.session.email ?? auth.session.userId ?? null, expectedScope });
    return NextResponse.json({ ok: true, link: `/ops-workspace/${issued.token}`, linkId: issued.linkId, expiresAt: issued.expiresAt });
  } catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось создать ссылку.' }, { status: 400 }); }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
  try { await revokeWorkerTaskLink({ bookingId: access.bookingId, linkId: String(body.linkId ?? ''), actorId: auth.session.email ?? auth.session.userId ?? null, expectedScope }); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось отозвать ссылку.' }, { status: 400 }); }
}
