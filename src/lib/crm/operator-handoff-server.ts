import { supabase } from '@/lib/supabase';
import { HANDOFF_UUID, parseHandoffProjection, type HandoffRequest, type OperatorHandoff } from './operator-handoff';

export type HandoffResult =
  | { ok: true; replayed: boolean; handoff: OperatorHandoff }
  | { ok: false; code: 'DISABLED' | 'DENIED' | 'CONFLICT' | 'UNAVAILABLE' | 'RECONCILIATION_REQUIRED'; status: number };

/** Exactly one transaction call. Unknown commit is never retried or reported as acknowledged. */
export async function transitionOperatorHandoff(actorId: string, request: HandoffRequest): Promise<HandoffResult> {
  if (process.env.CRM_OPERATOR_HANDOFF_MUTATIONS_ENABLED !== 'true') {
    return { ok: false, code: 'DISABLED', status: 503 };
  }
  try {
    const { data, error } = await supabase.rpc('crm_operator_handoff_transition_v1', {
      p_contact_id: request.contactId, p_actor_id: actorId, p_action: request.action,
      p_expected_generation: request.expectedGeneration, p_idempotency_key: request.idempotencyKey,
      p_assignee_id: request.assigneeId ?? null, p_backup_id: request.backupId ?? null,
      p_reason_code: request.reasonCode ?? null,
    });
    if (error) {
      if (error.code === '42501') return { ok: false, code: 'DENIED', status: 403 };
      if (['40001', '23505', '22023', '40P01'].includes(error.code)) return { ok: false, code: 'CONFLICT', status: 409 };
      if (['PGRST202', '42883', '42P01'].includes(error.code)) return { ok: false, code: 'UNAVAILABLE', status: 503 };
      return { ok: false, code: 'RECONCILIATION_REQUIRED', status: 503 };
    }
    const handoff = parseHandoffProjection(data?.handoff);
    if (!handoff || typeof data?.replayed !== 'boolean' || handoff.contactId !== request.contactId ||
        handoff.generation !== request.expectedGeneration + 1 ||
        (request.action === 'ack' && handoff.status !== 'acknowledged') ||
        (request.action === 'close' && handoff.status !== 'closed') ||
        (request.action === 'decline' && handoff.status !== 'needs_operator') ||
        (['assign', 'reassign'].includes(request.action) && !['assigned', 'needs_operator'].includes(handoff.status))) {
      return { ok: false, code: 'RECONCILIATION_REQUIRED', status: 503 };
    }
    return { ok: true, replayed: data.replayed, handoff };
  } catch {
    return { ok: false, code: 'RECONCILIATION_REQUIRED', status: 503 };
  }
}

/** SELECT-only RPC. Absent schema/rows never fabricate an accepted/unassigned receipt. */
export async function loadOperatorHandoffs(contactIds: string[]): Promise<Record<string, OperatorHandoff>> {
  const ids = [...new Set(contactIds.filter((id) => HANDOFF_UUID.test(id)).map((id) => id.toLowerCase()))];
  if (!ids.length) return {};
  const result: Record<string, OperatorHandoff> = {};
  try {
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      const { data, error } = await supabase.rpc('crm_operator_handoff_queue_v1', { p_contact_ids: batch });
      if (error || !Array.isArray(data)) return {};
      for (const raw of data) {
        const handoff = parseHandoffProjection(raw);
        if (!handoff || !batch.includes(handoff.contactId) || result[handoff.contactId]) return {};
        result[handoff.contactId] = handoff;
      }
    }
    return result;
  } catch { return {}; }
}
