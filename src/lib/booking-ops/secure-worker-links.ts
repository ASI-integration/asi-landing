import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import type { WorkerTaskRole } from './lifecycle-autopilot';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

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

export async function listWorkerTasks(bookingId: string) {
  const result = await supabase.from('booking_ops_worker_tasks').select('id,booking_id,task_key,assigned_role,assigned_person_id,status,deadline').eq('booking_id', bookingId).order('created_at');
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

export async function issueWorkerTaskLink(input: { bookingId: string; taskId: string; role: WorkerTaskRole; personId?: string | null; expiresAt: string; actorId?: string | null }) {
  const task = await supabase.from('booking_ops_worker_tasks').select('id,booking_id,assigned_role').eq('id', input.taskId).eq('booking_id', input.bookingId).single();
  if (task.error || !task.data) throw new Error('task_not_found');
  const token = randomBytes(32).toString('base64url');
  const linkId = randomUUID();
  const assignment = await supabase.from('booking_ops_worker_tasks').update({ assigned_role: input.role, assigned_person_id: input.personId ?? null, status: 'assigned', updated_at: new Date().toISOString() }).eq('id', input.taskId).eq('booking_id', input.bookingId);
  if (assignment.error) throw new Error(assignment.error.message);
  const revoke = await supabase.from('booking_ops_secure_task_links').update({ revoked_at: new Date().toISOString() }).eq('task_id', input.taskId).is('revoked_at', null);
  if (revoke.error) throw new Error(revoke.error.message);
  const created = await supabase.from('booking_ops_secure_task_links').insert({ id: linkId, task_id: input.taskId, token_hash: hash(token), actor_type: input.role, expires_at: input.expiresAt });
  if (created.error) throw new Error(created.error.message);
  await audit({ linkId, taskId: input.taskId, bookingId: input.bookingId, action: 'issued', actorType: 'operator', actorId: input.actorId, metadata: { role: input.role, expiresAt: input.expiresAt, regenerated: true } });
  return { linkId, token, expiresAt: input.expiresAt };
}

export async function revokeWorkerTaskLink(input: { bookingId: string; linkId: string; actorId?: string | null }) {
  const link = await supabase.from('booking_ops_secure_task_links').select('id,task_id,booking_ops_worker_tasks!inner(booking_id)').eq('id', input.linkId).single();
  const related = link.data?.booking_ops_worker_tasks as unknown as { booking_id?: string } | undefined;
  if (link.error || !link.data || related?.booking_id !== input.bookingId) throw new Error('link_not_found');
  const result = await supabase.from('booking_ops_secure_task_links').update({ revoked_at: new Date().toISOString() }).eq('id', input.linkId);
  if (result.error) throw new Error(result.error.message);
  await audit({ linkId: input.linkId, taskId: String(link.data.task_id), bookingId: input.bookingId, action: 'revoked', actorType: 'operator', actorId: input.actorId });
}

export async function auditWorkerLinkAction(input: { linkId: string; taskId: string; bookingId: string; action: 'opened' | 'started' | 'updated' | 'issue_reported' | 'completed'; actorType: string; actorId?: string | null }) {
  await audit(input);
}
