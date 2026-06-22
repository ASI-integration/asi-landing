import { supabase } from '@/lib/supabase';
import type { ObjectReadinessResult } from './engine';
import { createOpsTaskFromMissingOwnerData } from '@/lib/ops-board/integrations';

export type ObjectReadinessEventType =
  | 'object_readiness_updated'
  | 'object_readiness_missing_photos'
  | 'object_readiness_ready_for_cm'
  | 'object_readiness_requested_channels'
  | 'onboarding_channel_saved';

async function insertReadinessEvent(input: {
  contactId: string;
  eventType: ObjectReadinessEventType;
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
      console.error('[object-readiness] crm event insert failed', {
        eventType: input.eventType,
        error: error.message,
      });
    }
  } catch (error) {
    console.error('[object-readiness] crm event insert failed', error);
  }
}

export async function emitObjectReadinessEvents(params: {
  contactId: string | undefined;
  previousPercent: number | null;
  previousStatus?: ObjectReadinessResult['readiness_status'] | null;
  readiness: ObjectReadinessResult;
  photosIntentLater?: boolean;
}): Promise<void> {
  if (!params.contactId) return;

  const { readiness, previousPercent } = params;
  const percentChanged = previousPercent === null || previousPercent !== readiness.readiness_percent;
  const statusBecameReadyForCm =
    readiness.readiness_status === 'ready_for_channel_manager' &&
    params.previousStatus !== 'ready_for_channel_manager';

  if (percentChanged) {
    await insertReadinessEvent({
      contactId: params.contactId,
      eventType: 'object_readiness_updated',
      messageText: `Готовность объекта: ${readiness.readiness_percent}%`,
      metadata: {
        readiness_percent: readiness.readiness_percent,
        readiness_status: readiness.readiness_status,
        missing_required_fields: readiness.missing_required_fields,
      },
    });
  }

  if (
    readiness.readiness_status === 'missing_data' &&
    readiness.missing_required_fields.length > 0
  ) {
    await createOpsTaskFromMissingOwnerData({
      contactId: params.contactId,
      missingFields: readiness.missing_required_fields,
    });
  }

  if (statusBecameReadyForCm) {
    await insertReadinessEvent({
      contactId: params.contactId,
      eventType: 'object_readiness_ready_for_cm',
      messageText: 'Объект готов к Менеджеру каналов',
      metadata: { readiness_percent: readiness.readiness_percent },
    });
  }

  if (!percentChanged) return;

  const nextField = readiness.missing_required_fields[0];

  if (nextField === 'photos') {
    await insertReadinessEvent({
      contactId: params.contactId,
      eventType: 'object_readiness_missing_photos',
      messageText: 'Обнаружены недостающие фото объекта',
      metadata: { missing_field: 'photos' },
    });
  }

  if (nextField === 'channels') {
    await insertReadinessEvent({
      contactId: params.contactId,
      eventType: 'object_readiness_requested_channels',
      messageText: 'Запрошены каналы бронирования',
      metadata: { missing_field: 'channels' },
    });
  }
}

export async function emitOnboardingChannelSavedEvents(params: {
  contactId: string | undefined;
  channelLabels: string[];
}): Promise<void> {
  if (!params.contactId || !params.channelLabels.length) return;

  for (const label of params.channelLabels) {
    const trimmed = label.trim();
    if (!trimmed) continue;
    await insertReadinessEvent({
      contactId: params.contactId,
      eventType: 'onboarding_channel_saved',
      messageText: `ASI сохранила канал бронирования: ${trimmed}`,
      metadata: { channel_label: trimmed },
    });
  }
}
