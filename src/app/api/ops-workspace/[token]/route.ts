import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { durableEventId, recordAndProcessBookingEvent } from '@/lib/booking-ops/lifecycle-autopilot-service';
import { requireBookingOpsRecordScope } from '@/lib/booking-ops/repository';
import { auditWorkerLinkAction } from '@/lib/booking-ops/secure-worker-links';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const safeObject = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
type ExpectedScope = { accountId: string; propertyId: string };

export function workerCompletionEventType(role: string, taskKey: string) {
  return ({ cleaner: 'cleaner.task_completed', linen_worker: 'linen.task_completed', consumables: 'consumables.task_completed', inspector: taskKey.endsWith(':checkout:inspector') ? 'checkout.inspection_completed' : 'inspection.completed', maintenance_technician: 'maintenance.task_completed' }[role] ?? 'worker.task_completed');
}

async function load(token: string) {
  const link = await supabase.from('booking_ops_secure_task_links').select('id,task_id,actor_type,expires_at,revoked_at').eq('token_hash', hash(token)).maybeSingle();
  if (link.error || !link.data || link.data.revoked_at || new Date(link.data.expires_at).getTime() <= Date.now()) return null;
  const task = await supabase.from('booking_ops_worker_tasks').select('id,booking_id,object_id,task_key,assigned_role,status,deadline,checklist,notes,photo_attachments,issue_report,started_at,completed_at').eq('id', link.data.task_id).single();
  if (task.error) return null;
  return { link: link.data, task: task.data };
}

async function expectedTaskScope(task: Record<string, unknown>): Promise<ExpectedScope | undefined> {
  const bookingId = String(task.booking_id ?? '').trim();
  if (!bookingId) throw new Error('booking_scope_unavailable');
  const record = await supabase.from('booking_ops_records').select('account_id,property_id').eq('id', bookingId).maybeSingle();
  if (record.error) throw new Error(record.error.message);
  if (!record.data) return undefined;
  const accountId = String(record.data.account_id ?? '').trim();
  if (!accountId || accountId === 'legacy') return undefined;
  const propertyId = String(record.data.property_id ?? '').trim();
  const objectId = String(task.object_id ?? '').trim();
  if (!propertyId) throw new Error('booking_scope_unavailable');
  if (!objectId || objectId !== propertyId) throw new Error('booking_scope_mismatch');
  return { accountId, propertyId };
}

async function requireCurrentTaskScope(taskId: string, bookingId: string, expectedScope: ExpectedScope) {
  await requireBookingOpsRecordScope(bookingId, expectedScope);
  const current = await supabase
    .from('booking_ops_worker_tasks')
    .select('id')
    .eq('id', taskId)
    .eq('booking_id', bookingId)
    .eq('object_id', expectedScope.propertyId)
    .maybeSingle();
  if (current.error) throw new Error(current.error.message);
  if (!current.data) throw new Error('worker_task_scope_mismatch');
}

async function markLinkUsed(linkId: string, taskId: string, bookingId: string, expectedScope?: ExpectedScope) {
  if (expectedScope) await requireCurrentTaskScope(taskId, bookingId, expectedScope);
  const result = await supabase
    .from('booking_ops_secure_task_links')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', linkId)
    .eq('task_id', taskId);
  if (result.error) throw new Error(result.error.message);
  const matched = await supabase
    .from('booking_ops_secure_task_links')
    .select('id')
    .eq('id', linkId)
    .eq('task_id', taskId)
    .maybeSingle();
  if (matched.error) throw new Error(matched.error.message);
  if (!matched.data) throw new Error('worker_link_scope_mismatch');
  if (expectedScope) await requireCurrentTaskScope(taskId, bookingId, expectedScope);
}

async function auditScopedWorkerLink(input: { linkId: string; taskId: string; bookingId: string; action: 'opened' | 'started' | 'updated' | 'issue_reported' | 'completed'; actorType: string; actorId?: string | null }, expectedScope?: ExpectedScope) {
  if (expectedScope) await requireCurrentTaskScope(input.taskId, input.bookingId, expectedScope);
  await auditWorkerLinkAction(input);
  if (expectedScope) await requireCurrentTaskScope(input.taskId, input.bookingId, expectedScope);
}

export async function GET(_request: NextRequest, context: { params: { token: string } }) {
  const loaded = await load(context.params.token);
  if (!loaded) return NextResponse.json({ ok: false, error: 'Ссылка недействительна или срок её действия истёк.' }, { status: 410 });
  const expectedScope = await expectedTaskScope(loaded.task as Record<string, unknown>);
  const bookingId = String(loaded.task.booking_id);
  if (expectedScope) await requireBookingOpsRecordScope(bookingId, expectedScope);
  const taskId = String(loaded.task.id);
  await markLinkUsed(String(loaded.link.id), taskId, bookingId, expectedScope);
  await auditScopedWorkerLink({ linkId: String(loaded.link.id), taskId, bookingId, action: 'opened', actorType: String(loaded.link.actor_type), actorId: taskId }, expectedScope);
  if (expectedScope) await requireCurrentTaskScope(taskId, bookingId, expectedScope);
  return NextResponse.json({ ok: true, actorType: loaded.link.actor_type, task: loaded.task });
}

export async function PATCH(request: NextRequest, context: { params: { token: string } }) {
  const loaded = await load(context.params.token);
  if (!loaded) return NextResponse.json({ ok: false, error: 'Ссылка недействительна или срок её действия истёк.' }, { status: 410 });
  const expectedScope = await expectedTaskScope(loaded.task as Record<string, unknown>);
  const bookingId = String(loaded.task.booking_id);
  const taskId = String(loaded.task.id);
  if (expectedScope) await requireBookingOpsRecordScope(bookingId, expectedScope);
  await markLinkUsed(String(loaded.link.id), taskId, bookingId, expectedScope);

  const body = safeObject(await request.json().catch(() => ({})));
  const action = String(body.action ?? '');
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (action === 'start') Object.assign(patch, { status: 'in_progress', started_at: loaded.task.started_at ?? now });
  else if (action === 'save') Object.assign(patch, { checklist: Array.isArray(body.checklist) ? body.checklist : loaded.task.checklist, notes: String(body.notes ?? '').slice(0, 4000), photo_attachments: Array.isArray(body.photos) ? body.photos.slice(0, 30) : loaded.task.photo_attachments });
  else if (action === 'report_issue') Object.assign(patch, { status: 'blocked', issue_report: { summary: String(body.summary ?? '').slice(0, 1000), blocking: body.blocking !== false, reportedAt: now } });
  else if (action === 'complete') Object.assign(patch, { status: 'completed', completed_at: now, checklist: Array.isArray(body.checklist) ? body.checklist : loaded.task.checklist, notes: String(body.notes ?? loaded.task.notes ?? '').slice(0, 4000) });
  else return NextResponse.json({ ok: false, error: 'Неизвестное действие.' }, { status: 400 });

  if (expectedScope) await requireBookingOpsRecordScope(bookingId, expectedScope);
  let update = supabase.from('booking_ops_worker_tasks').update(patch).eq('id', loaded.task.id).eq('booking_id', bookingId);
  if (expectedScope) update = update.eq('object_id', expectedScope.propertyId);
  const updated = await update.select('*').maybeSingle();
  if (updated.error) return NextResponse.json({ ok: false, error: updated.error.message }, { status: 500 });
  if (!updated.data) return NextResponse.json({ ok: false, error: 'worker_task_scope_mismatch' }, { status: 409 });

  const role = String(loaded.task.assigned_role);
  const eventType = action === 'complete'
    ? workerCompletionEventType(role, String(loaded.task.task_key))
    : action === 'report_issue'
      ? 'damage.reported'
      : action === 'start'
        ? `${role}.task_started`
        : `${role}.task_updated`;
  await recordAndProcessBookingEvent({
    id: durableEventId('secure_task_workspace', String(loaded.task.id), action),
    bookingId,
    objectId: loaded.task.object_id ? String(loaded.task.object_id) : null,
    type: eventType,
    actorType: loaded.link.actor_type,
    actorId: String(loaded.task.id),
    source: 'secure_task_workspace',
    correlationId: durableEventId('worker_task', String(loaded.task.id)),
    payload: { taskId: loaded.task.id, taskKey: loaded.task.task_key, action },
  }, expectedScope);
  if (expectedScope) await requireCurrentTaskScope(taskId, bookingId, expectedScope);
  const auditAction = action === 'start'
    ? 'started'
    : action === 'report_issue'
      ? 'issue_reported'
      : action === 'complete'
        ? 'completed'
        : 'updated';
  await auditScopedWorkerLink({
    linkId: String(loaded.link.id),
    taskId,
    bookingId,
    action: auditAction,
    actorType: String(loaded.link.actor_type),
    actorId: taskId,
  }, expectedScope);
  if (expectedScope) await requireCurrentTaskScope(taskId, bookingId, expectedScope);
  return NextResponse.json({ ok: true, task: updated.data });
}
