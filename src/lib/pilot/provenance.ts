/**
 * SP-06 — Pilot Bridge handoff provenance + executor-compatibility checks.
 * Does not invent a pilot-only backend; tags the existing Bridge contract.
 */
import type { RuntimeBridgeTaskRequest } from '@/lib/asi-runtime/bridge-types';
import { PilotAccessError } from './errors';
import { isSafePilotBridgeId } from './ids';

export const PILOT_PROVENANCE_KIND = 'pilot' as const;
export const PILOT_PROVENANCE_PROFILE = 'strigunov_pilot_v1' as const;

/** Must stay aligned with PILOT_TEMPLATE_ID / PILOT_FIXED_REPOSITORY in template.ts. */
const PILOT_TEMPLATE_ID_MARKER = 'strigunov_pilot_green_v1';
const PILOT_FIXED_REPOSITORY_MARKER = 'ASI-integration/asi-landing';

/** Machine-checkable marker embedded in server-owned safetyConstraints. */
export const PILOT_PROVENANCE_MARKER =
  `Provenance: ${PILOT_PROVENANCE_KIND} / ${PILOT_PROVENANCE_PROFILE}` as const;

const SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BRIDGE_ENVELOPE_SCHEMA = 'asi.runtime.task.v1' as const;

export function isPilotConversationId(value: string): boolean {
  return /^pilot-beta-[a-f0-9]{24}$/.test(value) && isSafePilotBridgeId(value);
}

export function isPilotChatgptTaskId(value: string): boolean {
  return /^pilot-beta-task-[a-f0-9]{32}$/.test(value) && isSafePilotBridgeId(value);
}

export function taskRequestHasPilotProvenance(task: RuntimeBridgeTaskRequest): boolean {
  const constraints = task.safetyConstraints ?? [];
  return constraints.some((line) => line.includes(PILOT_PROVENANCE_MARKER)
    && line.includes(PILOT_TEMPLATE_ID_MARKER));
}

/**
 * Fail closed before Bridge RPC if the pilot submit payload is not claimable / tagged.
 */
export function assertPilotBridgeHandoffInput(input: {
  conversationId: string;
  chatgptTaskId: string;
  task: RuntimeBridgeTaskRequest;
}): void {
  if (!isPilotConversationId(input.conversationId)) {
    throw new PilotAccessError(
      'pilot_handoff_invalid',
      500,
      'Некорректный идентификатор разговора пилота.',
    );
  }
  if (!isPilotChatgptTaskId(input.chatgptTaskId)) {
    throw new PilotAccessError(
      'pilot_handoff_invalid',
      500,
      'Некорректный идентификатор задачи пилота.',
    );
  }
  if (input.task.repository !== PILOT_FIXED_REPOSITORY_MARKER) {
    throw new PilotAccessError(
      'pilot_handoff_invalid',
      500,
      'Репозиторий пилота не совпадает с разрешённым.',
    );
  }
  if (!SHA.test(input.task.baselineSha)) {
    throw new PilotAccessError(
      'pilot_handoff_invalid',
      500,
      'Некорректный baseline SHA пилота.',
    );
  }
  if (!taskRequestHasPilotProvenance(input.task)) {
    throw new PilotAccessError(
      'pilot_handoff_invalid',
      500,
      'Отсутствует provenance-маркер пилота.',
    );
  }
  const joined = [
    input.task.objective,
    ...input.task.instructions,
    ...(input.task.acceptanceCriteria ?? []),
    ...(input.task.safetyConstraints ?? []),
  ].join('\n');
  if (!joined.includes('docs/pilot/')) {
    throw new PilotAccessError(
      'pilot_handoff_invalid',
      500,
      'Область изменений пилота не зафиксирована.',
    );
  }
}

export type PilotClaimableEnvelope = {
  schemaVersion: typeof BRIDGE_ENVELOPE_SCHEMA;
  taskId: string;
  leaseToken: string;
  chatgptTaskId: string;
  conversationId: string;
  attemptCount: number;
  request: RuntimeBridgeTaskRequest;
  ownerDecision: null;
};

/**
 * Shape the existing bridge runner would send to the executor after claim.
 */
export function buildPilotClaimableEnvelope(input: {
  taskId: string;
  leaseToken: string;
  chatgptTaskId: string;
  conversationId: string;
  attemptCount: number;
  request: RuntimeBridgeTaskRequest;
}): PilotClaimableEnvelope {
  assertPilotBridgeHandoffInput({
    conversationId: input.conversationId,
    chatgptTaskId: input.chatgptTaskId,
    task: input.request,
  });
  if (!UUID.test(input.taskId) || !UUID.test(input.leaseToken)) {
    throw new PilotAccessError(
      'pilot_handoff_invalid',
      500,
      'Некорректные идентификаторы lease/task.',
    );
  }
  if (!Number.isInteger(input.attemptCount) || input.attemptCount < 1) {
    throw new PilotAccessError(
      'pilot_handoff_invalid',
      500,
      'Некорректный attemptCount.',
    );
  }
  return {
    schemaVersion: BRIDGE_ENVELOPE_SCHEMA,
    taskId: input.taskId,
    leaseToken: input.leaseToken,
    chatgptTaskId: input.chatgptTaskId,
    conversationId: input.conversationId,
    attemptCount: input.attemptCount,
    request: structuredClone(input.request),
    ownerDecision: null,
  };
}

/**
 * Mirror of executor envelope acceptance for pilot payloads (no Runtime import).
 */
export function assertExecutorCompatiblePilotEnvelope(envelope: PilotClaimableEnvelope): void {
  if (envelope.schemaVersion !== BRIDGE_ENVELOPE_SCHEMA) {
    throw new Error('bridge_envelope_schema');
  }
  if (!UUID.test(envelope.taskId) || !UUID.test(envelope.leaseToken)) {
    throw new Error('bridge_envelope_schema');
  }
  if (!isSafePilotBridgeId(envelope.chatgptTaskId) || !isSafePilotBridgeId(envelope.conversationId)) {
    throw new Error('bridge_envelope_schema');
  }
  if (!isPilotConversationId(envelope.conversationId) || !isPilotChatgptTaskId(envelope.chatgptTaskId)) {
    throw new Error('pilot_provenance_missing');
  }
  const request = envelope.request;
  if (request.repository !== PILOT_FIXED_REPOSITORY_MARKER) {
    throw new Error('repository_not_configured');
  }
  if (!SHA.test(request.baselineSha)) {
    throw new Error('bridge_baseline_invalid');
  }
  if (!Array.isArray(request.instructions) || request.instructions.length < 1) {
    throw new Error('bridge_envelope_schema');
  }
  if (!taskRequestHasPilotProvenance(request)) {
    throw new Error('pilot_provenance_missing');
  }
  if (envelope.ownerDecision !== null) {
    throw new Error('bridge_owner_decision_schema');
  }
}
