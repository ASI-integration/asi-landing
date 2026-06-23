import { supabase } from '@/lib/supabase';
import { createOrUpdateEscalationReview, type EscalationReview } from './operator-review';
import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';
import type { CommunicationChannel, Message, Role } from './types';

export type CommunicationEscalationSource = 'communication_autopilot' | 'telegram';

export type RecordCommunicationEscalationInput = {
  contactId?: string | null;
  guestId?: string | null;
  objectId?: string | null;
  messageText: string;
  summary?: string | null;
  reason: string;
  source: CommunicationEscalationSource;
  createdAt?: string;
  sessionId: string;
  channel: CommunicationChannel;
  targetId: string;
  actorId?: string;
  role?: Role;
  reservationId?: string;
  confidence?: number;
  suggestedReply?: string;
  detail?: string;
  sourceMeta?: Record<string, unknown>;
  latestMessages?: Message[];
  communicationStatus?: 'needs_manual_reaction' | 'has_problem';
};

const PROBLEM_REASONS = new Set([
  'complaint',
  'conflict',
  'refund_request',
  'has_problem',
  'guest_complaint',
  'urgent_issue',
]);

function resolveCommunicationStatus(
  reason: string,
  override?: 'needs_manual_reaction' | 'has_problem',
): 'needs_manual_reaction' | 'has_problem' {
  if (override) return override;
  const normalized = String(reason ?? '').trim().toLowerCase();
  if (PROBLEM_REASONS.has(normalized)) return 'has_problem';
  return 'needs_manual_reaction';
}

async function updateContactCommunicationStatus(input: {
  contactId: string;
  communicationStatus: 'needs_manual_reaction' | 'has_problem';
  createdAt?: string;
}): Promise<void> {
  const now = input.createdAt ?? new Date().toISOString();
  const { error } = await supabase
    .from('crm_contacts')
    .update({
      communication_status: input.communicationStatus,
      status: 'needs_reaction',
      next_action: 'Ответить гостю',
      last_activity_at: now,
    })
    .eq('id', input.contactId);

  if (error) {
    console.warn('[communication-escalations] contact update failed', {
      contactId: input.contactId,
      error: error.message,
    });
  }
}

/**
 * Records a communication escalation for OPS auto-sync.
 * Does not create OPS tasks directly — syncAutoOpsTasks() picks up pending reviews and CRM status.
 */
export async function recordCommunicationEscalation(
  input: RecordCommunicationEscalationInput,
): Promise<{ review: EscalationReview; contactId: string | null }> {
  const communicationStatus = resolveCommunicationStatus(input.reason, input.communicationStatus);
  const detail = input.detail ?? input.summary ?? input.messageText;
  const contactId = input.contactId?.trim() || null;

  const review = createOrUpdateEscalationReview({
    sessionId: input.sessionId,
    channel: input.channel,
    targetId: input.targetId,
    actorId: input.actorId,
    role: input.role,
    reservationId: input.reservationId,
    propertyId: input.objectId ?? undefined,
    leadId: contactId ?? undefined,
    escalationReason: input.reason,
    confidence: input.confidence,
    source: {
      ...(input.sourceMeta ?? {}),
      escalation_source: input.source,
      guest_id: input.guestId ?? null,
      message_preview: input.messageText.slice(0, 200),
      recorded_at: input.createdAt ?? new Date().toISOString(),
    },
    latestMessages: input.latestMessages,
    suggestedReply: input.suggestedReply,
    detail,
  });

  if (contactId) {
    await updateContactCommunicationStatus({
      contactId,
      communicationStatus,
      createdAt: input.createdAt,
    });
  }

  void syncAutoOpsTasks().catch((error) => {
    console.warn('[communication-escalations] ops sync after escalation failed', error);
  });

  return { review, contactId };
}
