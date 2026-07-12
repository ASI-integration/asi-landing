import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { durableEventId, recordAndProcessBookingEvent } from '@/lib/booking-ops/lifecycle-autopilot-service';
import { auditWorkerLinkAction } from '@/lib/booking-ops/secure-worker-links';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const safeObject = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function workerCompletionEventType(role: string, taskKey: string) {
  return ({ cleaner: 'cleaner.task_completed', linen_worker: 'linen.task_completed', consumables: 'consumables.task_completed', inspector: taskKey.endsWith(':checkout:inspector') ? 'checkout.inspection_completed' : 'inspection.completed', maintenance_technician: 'maintenance.task_completed' }[role] ?? 'worker.task_completed');
}

async function load(token: string) {
  const link = await supabase.from('booking_ops_secure_task_links').select('id,task_id,actor_type,expires_at,revoked_at').eq('token_hash', hash(token)).maybeSingle();
  if (link.error || !link.data || link.data.revoked_at || new Date(link.data.expires_at).getTime() <= Date.now()) return null;
  const task = await supabase.from('booking_ops_worker_tasks').select('id,booking_id,object_id,task_key,assigned_role,status,deadline,checklist,notes,photo_attachments,issue_report,started_at,completed_at').eq('id', link.data.task_id).single();
  if (task.error) return null;
  await supabase.from('booking_ops_secure_task_links').update({ last_used_at: new Date().toISOString() }).eq('id', link.data.id);
  return { link: link.data, task: task.data };
}

export async function GET(_request: NextRequest, context: { params: { token: string } }) {
  const loaded = await load(context.params.token);
  if (!loaded) return NextResponse.json({ ok: false, error: 'Ссылка недействительна или срок её действия истёк.' }, { status: 410 });
  await auditWorkerLinkAction({ linkId: String(loaded.link.id), taskId: String(loaded.task.id), bookingId: String(loaded.task.booking_id), action: 'opened', actorType: String(loaded.link.actor_type), actorId: String(loaded.task.id) });
  return NextResponse.json({ ok: true, actorType: loaded.link.actor_type, task: loaded.task });
}

export async function PATCH(request: NextRequest, context: { params: { token: string } }) {
  const loaded = await load(context.params.token);
  if (!loaded) return NextResponse.json({ ok: false, error: 'Ссылка недействительна или срок её действия истёк.' }, { status: 410 });
  const body = safeObject(await request.json().catch(() => ({})));
  const action = String(body.action ?? ''); const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (action === 'start') Object.assign(patch, { status: 'in_progress', started_at: loaded.task.started_at ?? now });
  else if (action === 'save') Object.assign(patch, { checklist: Array.isArray(body.checklist) ? body.checklist : loaded.task.checklist, notes: String(body.notes ?? '').slice(0, 4000), photo_attachments: Array.isArray(body.photos) ? body.photos.slice(0, 30) : loaded.task.photo_attachments });
  else if (action === 'report_issue') Object.assign(patch, { status: 'blocked', issue_report: { summary: String(body.summary ?? '').slice(0, 1000), blocking: body.blocking !== false, reportedAt: now } });
  else if (action === 'complete') Object.assign(patch, { status: 'completed', completed_at: now, checklist: Array.isArray(body.checklist) ? body.checklist : loaded.task.checklist, notes: String(body.notes ?? loaded.task.notes ?? '').slice(0, 4000) });
  else return NextResponse.json({ ok: false, error: 'Неизвестное действие.' }, { status: 400 });
  const updated = await supabase.from('booking_ops_worker_tasks').update(patch).eq('id', loaded.task.id).select('*').single();
  if (updated.error) return NextResponse.json({ ok: false, error: updated.error.message }, { status: 500 });
  const role = String(loaded.task.assigned_role);
  const eventType = action === 'complete' ? workerCompletionEventType(role, String(loaded.task.task_key)) : action === 'report_issue' ? 'damage.reported' : action === 'start' ? `${role}.task_started` : `${role}.task_updated`;
  await recordAndProcessBookingEvent({ id: durableEventId('secure_task_workspace', String(loaded.task.id), action), bookingId: String(loaded.task.booking_id), objectId: loaded.task.object_id ? String(loaded.task.object_id) : null, type: eventType, actorType: loaded.link.actor_type, actorId: String(loaded.task.id), source: 'secure_task_workspace', correlationId: durableEventId('worker_task', String(loaded.task.id)), payload: { taskId: loaded.task.id, taskKey: loaded.task.task_key, action } });
  const auditAction = action === 'start' ? 'started' : action === 'report_issue' ? 'issue_reported' : action === 'complete' ? 'completed' : 'updated';
  await auditWorkerLinkAction({ linkId: String(loaded.link.id), taskId: String(loaded.task.id), bookingId: String(loaded.task.booking_id), action: auditAction, actorType: String(loaded.link.actor_type), actorId: String(loaded.task.id) });
  return NextResponse.json({ ok: true, task: updated.data });
}
