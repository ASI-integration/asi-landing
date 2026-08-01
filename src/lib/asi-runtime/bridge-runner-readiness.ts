import 'server-only';
import type { RuntimeRunnerReadinessRecord } from './bridge-types';

const MAX_CLOCK_SKEW_MS = 5_000;
const MAX_RECORD_AGE_MS = 2 * 60_000;
const MIN_TTL_MS = 10_000;
const MAX_TTL_MS = 2 * 60_000;

type RunnerReadinessStore = Map<string, RuntimeRunnerReadinessRecord>;
type StoreGlobal = typeof globalThis & {
  __asiRuntimeRunnerReadiness?: RunnerReadinessStore;
};

function store(): RunnerReadinessStore {
  const target = globalThis as StoreGlobal;
  target.__asiRuntimeRunnerReadiness ??= new Map();
  return target.__asiRuntimeRunnerReadiness;
}

function timestamp(value: string): number {
  return Date.parse(value);
}

export class RuntimeRunnerReadinessError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function publishRuntimeRunnerReadiness(
  clientId: string,
  record: RuntimeRunnerReadinessRecord,
  now = Date.now(),
): RuntimeRunnerReadinessRecord {
  const checkedAt = timestamp(record.checkedAt);
  const expiresAt = timestamp(record.expiresAt);
  const ttl = expiresAt - checkedAt;
  if (!Number.isFinite(checkedAt) || !Number.isFinite(expiresAt)
    || checkedAt > now + MAX_CLOCK_SKEW_MS
    || checkedAt < now - MAX_RECORD_AGE_MS
    || expiresAt <= now
    || ttl < MIN_TTL_MS
    || ttl > MAX_TTL_MS) {
    throw new RuntimeRunnerReadinessError('runner_readiness_freshness_invalid');
  }

  const current = store().get(clientId);
  if (current && timestamp(current.expiresAt) > now && current.runnerId !== record.runnerId) {
    throw new RuntimeRunnerReadinessError('runner_identity_conflict');
  }
  store().set(clientId, structuredClone(record));
  return structuredClone(record);
}

export type RuntimeRunnerReadinessStatus =
  | { status: 'missing'; record: null }
  | { status: 'stale'; record: RuntimeRunnerReadinessRecord }
  | { status: 'fresh'; record: RuntimeRunnerReadinessRecord };

export function getRuntimeRunnerReadiness(
  clientId: string,
  now = Date.now(),
): RuntimeRunnerReadinessStatus {
  const record = store().get(clientId);
  if (!record) return { status: 'missing', record: null };
  const copy = structuredClone(record);
  return timestamp(copy.expiresAt) > now
    ? { status: 'fresh', record: copy }
    : { status: 'stale', record: copy };
}

export function __resetRuntimeRunnerReadinessForTests(): void {
  store().clear();
}
