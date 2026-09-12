/**
 * Authoritative Runtime execution-lane evidence.
 *
 * Bridge `asi_runtime_bridge_tasks` leases are NOT proof that the Runtime
 * single-runner lane can accept work. Runtime must publish this record
 * (runner-readiness `executionLane`, or a known control-plane blocker code).
 * Missing/unknown/expired evidence is fail-closed — never inferred as free.
 */

export const RUNTIME_EXECUTION_LANE_SCHEMA_VERSION = 'asi.runtime.execution-lane.v1' as const;

export const RUNTIME_EXECUTION_LANE_STATES = ['free', 'occupied', 'action_required'] as const;
export type RuntimeExecutionLaneState = (typeof RUNTIME_EXECUTION_LANE_STATES)[number];

export const RUNTIME_EXECUTION_LANE_REASON_CODES = {
  free: 'runtime_execution_lane_free',
  occupied: 'runtime_execution_lane_occupied',
  action_required: 'runtime_execution_lane_action_required',
} as const;

/** Control-plane / runner-readiness blocker codes that mean the lane is not free. */
export const RUNTIME_EXECUTION_LANE_BLOCKER_CODES = new Set([
  RUNTIME_EXECUTION_LANE_REASON_CODES.occupied,
  RUNTIME_EXECUTION_LANE_REASON_CODES.action_required,
  'runtime_control_plane_action_required',
]);

const LANE_EVIDENCE_KEYS = ['schemaVersion', 'state', 'reasonCode', 'checkedAt', 'expiresAt'] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type RuntimeExecutionLaneEvidence = {
  schemaVersion: typeof RUNTIME_EXECUTION_LANE_SCHEMA_VERSION;
  state: RuntimeExecutionLaneState;
  reasonCode: string;
  checkedAt: string;
  expiresAt: string;
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function laneText(value: unknown, max: number, pattern?: RegExp): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && value === value.trim()
    && (!pattern || pattern.test(value));
}

function expectedReasonCode(state: RuntimeExecutionLaneState): string {
  if (state === 'free') return RUNTIME_EXECUTION_LANE_REASON_CODES.free;
  if (state === 'occupied') return RUNTIME_EXECUTION_LANE_REASON_CODES.occupied;
  return RUNTIME_EXECUTION_LANE_REASON_CODES.action_required;
}

export function parseRuntimeExecutionLaneEvidence(value: unknown): RuntimeExecutionLaneEvidence | null {
  if (!object(value) || !exactKeys(value, LANE_EVIDENCE_KEYS)) return null;
  if (value.schemaVersion !== RUNTIME_EXECUTION_LANE_SCHEMA_VERSION) return null;
  if (typeof value.state !== 'string' || !RUNTIME_EXECUTION_LANE_STATES.includes(value.state as RuntimeExecutionLaneState)) {
    return null;
  }
  const state = value.state as RuntimeExecutionLaneState;
  if (!laneText(value.reasonCode, 120, ID) || value.reasonCode !== expectedReasonCode(state)) return null;
  if (!laneText(value.checkedAt, 64) || !laneText(value.expiresAt, 64)) return null;
  if (Number.isNaN(Date.parse(value.checkedAt)) || Number.isNaN(Date.parse(value.expiresAt))) return null;
  return {
    schemaVersion: RUNTIME_EXECUTION_LANE_SCHEMA_VERSION,
    state,
    reasonCode: value.reasonCode,
    checkedAt: value.checkedAt,
    expiresAt: value.expiresAt,
  };
}

function controlPlaneLaneBlocker(
  blockers: readonly string[] | undefined,
): 'occupied' | 'action_required' | null {
  if (!blockers || blockers.length === 0) return null;
  if (blockers.includes(RUNTIME_EXECUTION_LANE_REASON_CODES.occupied)) return 'occupied';
  if (
    blockers.includes(RUNTIME_EXECUTION_LANE_REASON_CODES.action_required)
    || blockers.includes('runtime_control_plane_action_required')
  ) {
    return 'action_required';
  }
  return null;
}

function blockedLaneEvidence(
  state: 'occupied' | 'action_required',
  checkedAt: string,
  expiresAt: string,
): RuntimeExecutionLaneEvidence {
  return {
    schemaVersion: RUNTIME_EXECUTION_LANE_SCHEMA_VERSION,
    state,
    reasonCode: expectedReasonCode(state),
    checkedAt,
    expiresAt,
  };
}

type RunnerRecordLaneSource = {
  schemaVersion?: string;
  checkedAt: string;
  expiresAt: string;
  blockers?: string[];
  executionLane?: unknown;
};

/**
 * Consume authoritative lane evidence from a published runner-readiness record.
 * Empty Bridge storage / empty blockers never become `free`.
 */
export function resolveRuntimeExecutionLaneEvidence(
  record: RunnerRecordLaneSource | null | undefined,
): RuntimeExecutionLaneEvidence | null {
  if (!record) return null;

  const parsedField = record.executionLane === undefined
    ? undefined
    : parseRuntimeExecutionLaneEvidence(record.executionLane);
  if (record.executionLane !== undefined && !parsedField) return null;

  const blockerState = controlPlaneLaneBlocker(record.blockers);

  if (blockerState) {
    if (parsedField && parsedField.state !== 'free') return parsedField;
    return blockedLaneEvidence(blockerState, record.checkedAt, record.expiresAt);
  }

  return parsedField ?? null;
}

export function isRuntimeExecutionLaneAuthoritativelyFree(
  evidence: RuntimeExecutionLaneEvidence | null | undefined,
  nowMs: number,
  clockSkewMs = 5_000,
): boolean {
  if (!evidence) return false;
  if (evidence.schemaVersion !== RUNTIME_EXECUTION_LANE_SCHEMA_VERSION) return false;
  if (evidence.state !== 'free') return false;
  if (evidence.reasonCode !== RUNTIME_EXECUTION_LANE_REASON_CODES.free) return false;
  const checkedAt = Date.parse(evidence.checkedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(expiresAt)) return false;
  if (checkedAt > nowMs + clockSkewMs) return false;
  if (expiresAt <= nowMs) return false;
  return true;
}
