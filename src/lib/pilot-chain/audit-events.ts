import { supabase } from '@/lib/supabase';
import type { PilotChainAuditEvent } from './types';

const AUDIT_LABELS: Record<PilotChainAuditEvent, string> = {
  lead_to_object_created: 'Создан черновик объекта из заявки CRM',
  object_to_channel_manager_prepared: 'Подготовлены данные для менеджера каналов',
  ops_case_created: 'Создана OPS-задача по контуру пилота',
  skipped_existing_object: 'Объект уже связан с заявкой — дубль не создан',
  skipped_existing_ops: 'OPS-задача уже существует — дубль не создан',
};

export async function emitPilotChainAuditEvent(input: {
  contactId: string;
  eventType: PilotChainAuditEvent;
  objectId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const messageText = AUDIT_LABELS[input.eventType];
  try {
    const { error } = await supabase.from('crm_events').insert({
      contact_id: input.contactId,
      event_type: input.eventType,
      message_text: messageText,
      metadata: {
        object_id: input.objectId ?? null,
        integration: 'pilot_chain',
        ...input.metadata,
      },
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.warn('[pilot-chain] audit event insert failed', {
        eventType: input.eventType,
        error: error.message,
      });
    }
  } catch (error) {
    console.warn('[pilot-chain] audit event insert failed', error);
  }
}

export function logPilotChainStep(
  eventType: PilotChainAuditEvent,
  details: Record<string, unknown>,
): void {
  console.info(`[pilot-chain] ${eventType}`, details);
}
