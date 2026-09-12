/**
 * Fail-closed /pilot readiness.
 * Authoritative execution availability is runner-readiness.v2
 * `capabilities.executor` after owner-console reconciliation, and only when
 * reasonCode is runtime_execution_lane_ready.
 * Public view never includes components, paths, secrets, or internal words.
 */
import 'server-only';
import { isAuthoritativeExecutionLaneReady } from '@/lib/asi-runtime/execution-lane-contract';
import { getDevelopmentReadiness } from '@/lib/development/readiness';
import type {
  DevelopmentReadinessComponent,
  DevelopmentReadinessSnapshot,
} from '@/lib/development/readiness-types';
import { PilotAccessError } from './errors';
import { PILOT_USER_STATE } from './user-copy';

export type PilotReadinessState = 'ready' | 'not_ready' | 'error';

export type PilotReadinessView = {
  state: PilotReadinessState;
  canSubmit: boolean;
  messageRu: string;
  checkedAt: string;
};

const MSG_READY = PILOT_USER_STATE.readyToWork;
const MSG_UNAVAILABLE = PILOT_USER_STATE.temporarilyUnavailable;

const ORIGIN_INVALID_CODES = new Set([
  'runtime_checkout_remote_missing',
  'runtime_checkout_remote_mismatch',
]);

const BASELINE_UNACCEPTABLE_CODES = new Set([
  'baseline_unavailable',
  'runtime_baseline_remote_mismatch',
  'runtime_baseline_remote_unavailable',
  'runtime_checkout_baseline_unavailable',
  'runtime_baseline_recovery_unavailable',
]);

const STALE_RUNNER_CODES = new Set([
  'runtime_runner_readiness_stale',
]);

const RUNNER_MISSING_CODES = new Set([
  'runtime_runner_readiness_missing',
]);

const CLOCK_SKEW_MS = 5_000;

export type PilotReadinessDependencies = {
  loadOwnerReadiness?: () => Promise<DevelopmentReadinessSnapshot>;
  now?: () => Date;
};

function publicView(
  state: PilotReadinessState,
  canSubmit: boolean,
  checkedAt: string,
): PilotReadinessView {
  return {
    state,
    canSubmit,
    messageRu: canSubmit ? MSG_READY : MSG_UNAVAILABLE,
    checkedAt,
  };
}

function isReadyComponent(component: DevelopmentReadinessComponent | undefined): boolean {
  return Boolean(
    component
    && component.state === 'ready'
    && component.blockingLaunch === false,
  );
}

function isFreshV2RunnerEvidence(
  evidence: DevelopmentReadinessSnapshot['runnerEvidence'],
  nowMs: number,
): boolean {
  if (!evidence) return false;
  if (evidence.schemaVersion !== 'asi.runtime.runner-readiness.v2') return false;
  const checkedAt = Date.parse(evidence.checkedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(expiresAt)) return false;
  if (checkedAt > nowMs + CLOCK_SKEW_MS) return false;
  if (expiresAt <= nowMs) return false;
  if (evidence.readinessState !== 'ready') return false;
  if (evidence.blockingReason) return false;
  return true;
}

function reasonOf(
  snapshot: DevelopmentReadinessSnapshot,
  id: keyof DevelopmentReadinessSnapshot['components'],
): string {
  return snapshot.components?.[id]?.reasonCode ?? '';
}

function isAuthoritativeExecutorReady(
  executor: DevelopmentReadinessComponent | undefined,
): boolean {
  return Boolean(executor && isAuthoritativeExecutionLaneReady(executor));
}

/**
 * Truthful AND-gate for /pilot create. Unknown/stale/missing/blocked → fail closed.
 * Executor availability requires lane-aware Runtime #127 evidence:
 * state=ready, blockingLaunch=false, reasonCode=runtime_execution_lane_ready.
 */
export function evaluatePilotReadiness(input: {
  snapshot: DevelopmentReadinessSnapshot | null | undefined;
  nowMs: number;
}): { ok: boolean; failClosed: boolean } {
  const snapshot = input.snapshot;
  if (!snapshot) {
    return { ok: false, failClosed: true };
  }
  if (snapshot.canLaunch !== true) {
    return { ok: false, failClosed: true };
  }

  const bridge = snapshot.components?.bridge;
  const checkouts = snapshot.components?.checkouts;
  const baseline = snapshot.components?.baseline;
  const executor = snapshot.components?.executor;

  if (!isReadyComponent(bridge)) return { ok: false, failClosed: true };
  const runnerEvidence = snapshot.runnerEvidence;
  if (!isFreshV2RunnerEvidence(runnerEvidence, input.nowMs) || !runnerEvidence) {
    return { ok: false, failClosed: true };
  }
  if (
    runnerEvidence.observedBaselineSha
    && runnerEvidence.verifiedBaselineSha
    && runnerEvidence.observedBaselineSha !== runnerEvidence.verifiedBaselineSha
  ) {
    return { ok: false, failClosed: true };
  }
  if (!isReadyComponent(checkouts)) return { ok: false, failClosed: true };
  if (ORIGIN_INVALID_CODES.has(reasonOf(snapshot, 'checkouts'))) {
    return { ok: false, failClosed: true };
  }
  if (!isReadyComponent(baseline)) return { ok: false, failClosed: true };
  if (BASELINE_UNACCEPTABLE_CODES.has(reasonOf(snapshot, 'baseline'))) {
    return { ok: false, failClosed: true };
  }
  if (BASELINE_UNACCEPTABLE_CODES.has(reasonOf(snapshot, 'checkouts'))) {
    return { ok: false, failClosed: true };
  }
  if (!isAuthoritativeExecutorReady(executor)) return { ok: false, failClosed: true };
  if (STALE_RUNNER_CODES.has(reasonOf(snapshot, 'checkouts'))
    || STALE_RUNNER_CODES.has(reasonOf(snapshot, 'executor'))
    || RUNNER_MISSING_CODES.has(reasonOf(snapshot, 'checkouts'))
    || RUNNER_MISSING_CODES.has(reasonOf(snapshot, 'executor'))) {
    return { ok: false, failClosed: true };
  }
  if (Object.values(snapshot.components ?? {}).some((item) => item?.blockingLaunch === true)) {
    return { ok: false, failClosed: true };
  }
  return { ok: true, failClosed: false };
}

/**
 * Safe pilot-facing readiness derived from owner-console / runner-readiness.v2.
 */
export async function getPilotReadiness(
  deps: PilotReadinessDependencies = {},
): Promise<PilotReadinessView> {
  const now = deps.now ?? (() => new Date());
  const checkedFallback = now().toISOString();
  try {
    const snapshot = await (deps.loadOwnerReadiness ?? getDevelopmentReadiness)();
    const verdict = evaluatePilotReadiness({
      snapshot,
      nowMs: now().getTime(),
    });
    if (!verdict.ok) {
      return publicView('not_ready', false, snapshot.checkedAt || checkedFallback);
    }
    return publicView('ready', true, snapshot.checkedAt || checkedFallback);
  } catch {
    return publicView('error', false, checkedFallback);
  }
}

/**
 * Fail closed before create when the complete execution path is not usable.
 */
export async function assertPilotSubmissionReady(
  deps: PilotReadinessDependencies = {},
): Promise<PilotReadinessView> {
  const readiness = await getPilotReadiness(deps);
  if (readiness.state === 'error') {
    throw new PilotAccessError('readiness_unavailable', 503, readiness.messageRu);
  }
  if (!readiness.canSubmit || readiness.state !== 'ready') {
    throw new PilotAccessError('readiness_blocked', 503, readiness.messageRu);
  }
  return readiness;
}
