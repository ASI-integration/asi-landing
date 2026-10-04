import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { requireBookingOpsRecordScope } from './repository';
import type { WorkerTaskRole } from './lifecycle-autopilot';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
type ExpectedScope = { accountId: string; propertyId: string };

export function workerLinkIsUsable(link: { revokedAt?: string | null; expiresAt: string }, now = Date.now()) {
  return !link.revokedAt && new Date(link.expiresAt).getTime() > now;
}

export function workerLinkTaskScope(linkTaskId: string, requestedTaskId: string) {
  return linkTaskId === requestedTaskId;
}

async function audit(input: { linkId?: string | null; taskId: string; bookingId: string; action: string; actorType: string; actorId?: string | null; metadata?: Record<string, unknown> }) {
  const result = await supabase.from('booking_ops_worker_link_audit').insert({ id: randomUUID(), link_id: input.linkId ?? null, task_id: input.taskId, booking_id: input.bookingId, action: input.action, actor_type: input.actorType, actor_id: input.actorId ?? null, metadata: input.metadata ?? {} });
  if (result.error) throw new Error(result.error.message);
}

async function requireWorkerTaskScope(bookingId: string, taskId: string, expectedScope: ExpectedScope) {
  await requireBookingOpsRecordScope(bookingId, expectedScope);
  const task = await supabase
    .from('booking_ops_worker_tasks')
    .select('id,booking_id,object_id,assigned_role')
    .eq('id', taskId)
    .eq('booking_id', bookingId)
    .eq('object_id', expectedScope.propertyId)
    .maybeSingle();
  if (task.error) throw new Error(task.error.message);
  if (!task.data) throw new Error('worker_task_scope_mismatch');
  return task.data;
}

export async function listWorkerTasks(bookingId: string, expectedScope?: ExpectedScope) {
  if (expectedScope) await requireBookingOpsRecordScope(bookingId, expectedScope);
  let query = supabase
    .from('booking_ops_worker_tasks')
    .select('id,booking_id,object_id,task_key,assigned_role,assigned_person_id,status,deadline')
    .eq('booking_id', bookingId);
  if (expectedScope) query = query.eq('object_id', expectedScope.propertyId);
  const result = await query.order('created_at');
  if (result.error) throw new Error(result.error.message);
  if (expectedScope) await requireBookingOpsRecordScope(bookingId, expectedScope);
  return result.data ?? [];
}

export async function issueWorkerTaskLink(input: { bookingId: string; taskId: string; role: WorkerTaskRole; personId?: string | null; expiresAt: string; actorId?: string | null; expectedScope?: ExpectedScope }) {
  if (input.expectedScope) {
    await requireWorkerTaskScope(input.bookingId, input.taskId, input.expectedScope);
  } else {
    const task = await supabase.from('booking_ops_worker_tasks').select('id,booking_id,assigned_role').eq('id', input.taskId).eq('booking_id', input.bookingId).single();
    if (task.error || !task.data) throw new Error('task_not_found');
  }
  const token = randomBytes(32).toString('base64url');
  const linkId = randomUUID();
  if (input.expectedScope) await requireWorkerTaskScope(input.bookingId, input.taskId, input.expectedScope);
  let assignmentQuery = supabase.from('booking_ops_worker_tasks').update({ assigned_role: input.role, assigned_person_id: input.personId ?? null, status: 'assigned', updated_at: new Date().toISOString() }).eq('id', input.taskId).eq('booking_id', input.bookingId);
  if (input.expectedScope) assignmentQuery = assignmentQuery.eq('object_id', input.expectedScope.propertyId);
  const assignment = await assignmentQuery;
  if (assignment.error) throw new Error(assignment.error.message);
  if (input.expectedScope) await requireWorkerTaskScope(input.bookingId, input.taskId, input.expectedScope);
  const revoke = await supabase.from('booking_ops_secure_task_links').update({ revoked_at: new Date().toISOString() }).eq('task_id', input.taskId).is('revoked_at', null);
  if (revoke.error) throw new Error(revoke.error.message);
  if (input.expectedScope) await requireWorkerTaskScope(input.bookingId, input.taskId, input.expectedScope);
  const created = await supabase.from('booking_ops_secure_task_links').insert({ id: linkId, task_id: input.taskId, token_hash: hash(token), actor_type: input.role, expires_at: input.expiresAt });
  if (created.error) throw new Error(created.error.message);
  if (input.expectedScope) await requireBookingOpsRecordScope(input.bookingId, input.expectedScope);
  await audit({ linkId, taskId: input.taskId, bookingId: input.bookingId, action: 'issued', actorType: 'operator', actorId: input.actorId, metadata: { role: input.role, expiresAt: input.expiresAt, regenerated: true } });
  return { linkId, token, expiresAt: input.expiresAt };
}

export async function revokeWorkerTaskLink(input: { bookingId: string; linkId: string; actorId?: string | null; expectedScope?: ExpectedScope }) {
  if (input.expectedScope) await requireBookingOpsRecordScope(input.bookingId, input.expectedScope);
  const link = await supabase.from('booking_ops_secure_task_links').select('id,task_id,booking_ops_worker_tasks!inner(booking_id,object_id)').eq('id', input.linkId).single();
  const related = link.data?.booking_ops_worker_tasks as unknown as { booking_id?: string; object_id?: string | null } | undefined;
  if (link.error || !link.data || related?.booking_id !== input.bookingId) throw new Error('link_not_found');
  if (input.expectedScope && related?.object_id !== input.expectedScope.propertyId) throw new Error('worker_task_scope_mismatch');
  if (input.expectedScope) await requireWorkerTaskScope(input.bookingId, String(link.data.task_id), input.expectedScope);
  const result = await supabase.from('booking_ops_secure_task_links').update({ revoked_at: new Date().toISOString() }).eq('id', input.linkId);
  if (result.error) throw new Error(result.error.message);
  if (input.expectedScope) await requireBookingOpsRecordScope(input.bookingId, input.expectedScope);
  await audit({ linkId: input.linkId, taskId: String(link.data.task_id), bookingId: input.bookingId, action: 'revoked', actorType: 'operator', actorId: input.actorId });
}

export async function auditWorkerLinkAction(input: { linkId: string; taskId: string; bookingId: string; action: 'opened' | 'started' | 'updated' | 'issue_reported' | 'completed'; actorType: string; actorId?: string | null }) {
  await audit(input);
}
