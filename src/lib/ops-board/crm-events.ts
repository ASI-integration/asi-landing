import { supabase } from '@/lib/supabase';

export type OpsBoardCrmEventType =
  | 'ops_task_created'
  | 'ops_task_in_progress'
  | 'ops_task_waiting_owner'
  | 'ops_task_closed';

async function insertOpsBoardCrmEvent(input: {
  contactId?: string | null;
  eventType: OpsBoardCrmEventType;
  messageText: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  if (!input.contactId?.trim()) return;

  try {
    const { error } = await supabase.from('crm_events').insert({
      contact_id: input.contactId.trim(),
      event_type: input.eventType,
      message_text: input.messageText,
      metadata: input.metadata,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.error('[ops-board] crm event insert failed', {
        eventType: input.eventType,
        error: error.message,
      });
    }
  } catch (error) {
    console.error('[ops-board] crm event insert failed', error);
  }
}

export async function emitOpsTaskCreatedEvent(params: {
  contactId?: string | null;
  taskId: string;
  taskType: string;
  title: string;
  source: string;
  objectId?: string | null;
}): Promise<void> {
  await insertOpsBoardCrmEvent({
    contactId: params.contactId,
    eventType: 'ops_task_created',
    messageText: 'ASI создала операционную задачу',
    metadata: {
      task_id: params.taskId,
      task_type: params.taskType,
      title: params.title,
      source: params.source,
      object_id: params.objectId ?? null,
    },
  });
}

export async function emitOpsTaskStatusEvent(params: {
  contactId?: string | null;
  taskId: string;
  taskType: string;
  taskStatus: string;
  title: string;
}): Promise<void> {
  const eventByStatus: Partial<Record<string, { eventType: OpsBoardCrmEventType; messageText: string }>> = {
    in_progress: {
      eventType: 'ops_task_in_progress',
      messageText: 'Оператор взял задачу в работу',
    },
    waiting_owner: {
      eventType: 'ops_task_waiting_owner',
      messageText: 'Задача ждёт владельца',
    },
    done: {
      eventType: 'ops_task_closed',
      messageText: 'Операционная задача закрыта',
    },
    closed: {
      eventType: 'ops_task_closed',
      messageText: 'Операционная задача закрыта',
    },
  };

  const mapped = eventByStatus[params.taskStatus];
  if (!mapped) return;

  await insertOpsBoardCrmEvent({
    contactId: params.contactId,
    eventType: mapped.eventType,
    messageText: mapped.messageText,
    metadata: {
      task_id: params.taskId,
      task_type: params.taskType,
      task_status: params.taskStatus,
      title: params.title,
    },
  });
}
