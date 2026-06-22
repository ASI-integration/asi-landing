import { supabase } from '@/lib/supabase';
import type { ChannelManagerAccessSituation, ChannelManagerConnectionMethod } from './types';
import { CHANNEL_MANAGER_CONNECTION_METHOD_LABELS } from './labels';

export type ChannelManagerConnectionEventType =
  | 'channel_manager_flow_prepared'
  | 'channel_manager_method_selected'
  | 'channel_manager_access_requested'
  | 'channel_manager_needs_operator'
  | 'channel_manager_connection_prepared';

async function insertEvent(input: {
  contactId: string;
  eventType: ChannelManagerConnectionEventType;
  messageText: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await supabase.from('crm_events').insert({
      contact_id: input.contactId,
      event_type: input.eventType,
      message_text: input.messageText,
      metadata: input.metadata,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.error('[channel-manager-connection] crm event insert failed', {
        eventType: input.eventType,
        error: error.message,
      });
    }
  } catch (error) {
    console.error('[channel-manager-connection] crm event insert failed', error);
  }
}

export async function emitChannelManagerFlowPrepared(params: {
  contactId: string;
  objectId: string;
}): Promise<void> {
  await insertEvent({
    contactId: params.contactId,
    eventType: 'channel_manager_flow_prepared',
    messageText: 'ASI подготовила переход к Менеджеру каналов',
    metadata: { object_id: params.objectId },
  });
}

export async function emitChannelManagerMethodSelected(params: {
  contactId: string;
  objectId: string;
  method: ChannelManagerConnectionMethod;
  customManagerName?: string | null;
}): Promise<void> {
  const label =
    params.method === 'other' && params.customManagerName
      ? params.customManagerName
      : CHANNEL_MANAGER_CONNECTION_METHOD_LABELS[params.method];

  await insertEvent({
    contactId: params.contactId,
    eventType: 'channel_manager_method_selected',
    messageText: `Выбран способ подключения: ${label}`,
    metadata: {
      object_id: params.objectId,
      method: params.method,
      method_label: label,
      custom_manager_name: params.customManagerName ?? null,
    },
  });
}

export async function emitChannelManagerAccessRequested(params: {
  contactId: string;
  objectId: string;
  method: ChannelManagerConnectionMethod;
  access: ChannelManagerAccessSituation;
}): Promise<void> {
  await insertEvent({
    contactId: params.contactId,
    eventType: 'channel_manager_access_requested',
    messageText: 'ASI запросила доступы',
    metadata: {
      object_id: params.objectId,
      method: params.method,
      access: params.access,
    },
  });
}

export async function emitChannelManagerNeedsOperator(params: {
  contactId: string;
  objectId: string;
  method: ChannelManagerConnectionMethod;
}): Promise<void> {
  await insertEvent({
    contactId: params.contactId,
    eventType: 'channel_manager_needs_operator',
    messageText: 'ASI отметила подключение как требующее оператора',
    metadata: { object_id: params.objectId, method: params.method },
  });
}

export async function emitChannelManagerConnectionPrepared(params: {
  contactId: string;
  objectId: string;
  method: ChannelManagerConnectionMethod;
}): Promise<void> {
  await insertEvent({
    contactId: params.contactId,
    eventType: 'channel_manager_connection_prepared',
    messageText: 'Подключение каналов подготовлено',
    metadata: { object_id: params.objectId, method: params.method },
  });
}
