/**
 * Safe owner/HITL view for /pilot. Reuses the existing owner-gate record;
 * never exposes raw diagnostic payloads or privileged merge/deploy actions.
 */
import type { RuntimeBridgeOwnerGateView } from '@/lib/asi-runtime/bridge-types';
import { containsForbiddenStringContent } from '@/lib/asi-runtime/ingest-schema';
import { PILOT_USER_STATE, sanitizePilotUserText } from './user-copy';

const PRIVILEGED_GATE_PATTERN =
  /\b(merge|deploy|release|production|prod\b|secret|secrets|dns\b|payment|payments|migration|migrations|force[- ]?push|rollback)\b/i;

export type PilotHitlView = {
  required: true;
  questionRu: string;
  reasonRu: string | null;
  canContinue: boolean;
  gateId: string;
  taskCycle: string;
};

export function isPrivilegedPilotOwnerGate(
  gate: Pick<RuntimeBridgeOwnerGateView, 'action' | 'allowedSideEffect' | 'exactTarget'>,
): boolean {
  const haystack = `${gate.action} ${gate.allowedSideEffect} ${gate.exactTarget}`;
  return PRIVILEGED_GATE_PATTERN.test(haystack);
}

function safeGateText(value: unknown): string | null {
  const sanitized = sanitizePilotUserText(value);
  if (!sanitized) return null;
  if (containsForbiddenStringContent(sanitized)) return null;
  return sanitized;
}

/**
 * Map a pending owner gate into a pilot-safe HITL prompt.
 * Privileged red actions stay visible as a question but cannot be continued from /pilot.
 */
export function buildPilotHitlView(
  gate: RuntimeBridgeOwnerGateView | null | undefined,
): PilotHitlView | null {
  if (!gate || gate.status !== 'pending') return null;
  if (!gate.gateId || !gate.taskCycle) return null;

  const reasonRu = safeGateText(gate.reason);
  const questionRu = reasonRu
    || safeGateText(gate.action)
    || PILOT_USER_STATE.needsAnswer;

  return {
    required: true,
    questionRu,
    reasonRu: reasonRu && reasonRu !== questionRu ? reasonRu : reasonRu,
    canContinue: !isPrivilegedPilotOwnerGate(gate),
    gateId: gate.gateId,
    taskCycle: gate.taskCycle,
  };
}
