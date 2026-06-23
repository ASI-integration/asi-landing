import { buildAutoOpsDedupKey } from '@/lib/ops-board/repository';
import type { OpsTaskType } from '@/lib/ops-board/types';
import { computePilotReadiness } from './engine';
import type { PilotObjectSnapshot } from './types';
import { PILOT_READINESS_CHECK_LABELS_RU } from './types';

export type PilotReadinessOpsSeed = {
  dedupKey: string;
  taskType: OpsTaskType;
  taskStatus: 'new' | 'needs_operator';
  source: 'channel_manager';
  integration: string;
  sourceId: string;
  contactId?: string | null;
  objectId: string;
  objectLabel?: string | null;
  ownerName?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
};

export function collectPilotReadinessSeeds(snapshots: PilotObjectSnapshot[]): PilotReadinessOpsSeed[] {
  const seeds: PilotReadinessOpsSeed[] = [];

  for (const snapshot of snapshots) {
    const result = computePilotReadiness(snapshot);
    if (result.ready) continue;

    seeds.push({
      dedupKey: buildAutoOpsDedupKey({
        source: 'object_passport',
        sourceId: snapshot.propertyId,
        taskType: 'request_owner_data',
      }),
      taskType: 'request_owner_data',
      taskStatus: 'needs_operator',
      source: 'channel_manager',
      integration: 'pilot_readiness',
      sourceId: snapshot.propertyId,
      contactId: snapshot.contactId,
      objectId: snapshot.propertyId,
      objectLabel: snapshot.objectLabel ?? snapshot.name,
      ownerName: snapshot.ownerName,
      description: 'Подготовить объект к пилоту: не хватает данных',
      metadata: {
        pilot_readiness: true,
        missing_checks: result.missingCheckIds,
        missing_labels: result.missingLabelsRu,
        missing_labels_map: Object.fromEntries(
          result.missingCheckIds.map((id) => [id, PILOT_READINESS_CHECK_LABELS_RU[id]]),
        ),
      },
    });
  }

  return seeds;
}

export function collectGuestReplyDataMissingSeed(input: {
  propertyId: string;
  objectLabel?: string | null;
  contactId?: string | null;
  sessionId?: string | null;
  questionHint?: string | null;
}): PilotReadinessOpsSeed {
  const propertyId = String(input.propertyId).trim();
  const sourceId = input.sessionId?.trim() || propertyId;
  return {
    dedupKey: buildAutoOpsDedupKey({
      source: 'communications',
      sourceId: `guest_reply_missing:${sourceId}`,
      taskType: 'request_owner_data',
    }),
    taskType: 'request_owner_data',
    taskStatus: 'needs_operator',
    source: 'channel_manager',
    integration: 'guest_reply_data',
    sourceId,
    contactId: input.contactId ?? null,
    objectId: propertyId,
    objectLabel: input.objectLabel ?? propertyId,
    description: 'Не хватает данных для ответа гостю',
    metadata: {
      reason: 'guest_reply_data_missing',
      question_hint: input.questionHint ?? null,
    },
  };
}
