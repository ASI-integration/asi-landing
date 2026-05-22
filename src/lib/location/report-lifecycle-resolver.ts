import {
  MATERIALIZED_REPORT_STATUS,
  type MaterializedReport,
} from './report-materialized';
import {
  REPORT_LIFECYCLE_CLEANUP_STRATEGY,
  REPORT_LIFECYCLE_REGENERATION_STRATEGY,
  type ReportLifecycleCleanupStrategy,
  type ReportLifecyclePolicy,
  type ReportLifecyclePolicyOverrides,
  type ReportLifecycleRegenerationStrategy,
  resolveMaterializedReportLifecyclePolicy,
} from './report-lifecycle-policy';

export const REPORT_LIFECYCLE_ACTION_TYPE = {
  markStale: 'mark_stale',
  lazyRegenerate: 'lazy_regenerate',
  cleanup: 'cleanup',
} as const;

export type ReportLifecycleActionType =
  (typeof REPORT_LIFECYCLE_ACTION_TYPE)[keyof typeof REPORT_LIFECYCLE_ACTION_TYPE];

export type ReportLifecycleMarkStaleAction = {
  type: typeof REPORT_LIFECYCLE_ACTION_TYPE.markStale;
  materialized_id: string;
  target: MaterializedReport['target'];
  reason: 'version_mismatch' | 'time_stale' | 'expired';
};

export type ReportLifecycleLazyRegenerateAction = {
  type: typeof REPORT_LIFECYCLE_ACTION_TYPE.lazyRegenerate;
  materialized_id: string;
  snapshot_id: string;
  target: MaterializedReport['target'];
  regeneration_strategy: ReportLifecycleRegenerationStrategy;
};

export type ReportLifecycleCleanupAction = {
  type: typeof REPORT_LIFECYCLE_ACTION_TYPE.cleanup;
  materialized_id: string;
  target: MaterializedReport['target'];
  cleanup_strategy: ReportLifecycleCleanupStrategy;
};

export type ReportLifecycleAction =
  | ReportLifecycleMarkStaleAction
  | ReportLifecycleLazyRegenerateAction
  | ReportLifecycleCleanupAction;

export type MaterializedReportLifecycleEvaluation = {
  materialized_id: string;
  target: MaterializedReport['target'];
  expired: boolean;
  time_stale: boolean;
  version_stale: boolean;
  stale: boolean;
  should_regenerate: boolean;
  recommend_lazy_regeneration: boolean;
};

function lifecycleMaterializedAt(materialized: MaterializedReport): string {
  const lifecycle = materialized.metadata?.lifecycle;
  if (lifecycle && typeof lifecycle.materialized_at === 'string') {
    return lifecycle.materialized_at;
  }
  if (typeof materialized.metadata?.materialized_at === 'string') {
    return materialized.metadata.materialized_at;
  }
  return materialized.updated_at;
}

function lifecycleStaleAfterAt(materialized: MaterializedReport): string | null {
  const lifecycle = materialized.metadata?.lifecycle;
  if (lifecycle && typeof lifecycle.stale_after_at === 'string') {
    return lifecycle.stale_after_at;
  }
  if (lifecycle && lifecycle.stale_after_at === null) return null;
  return null;
}

export function isMaterializedReportExpired(
  materialized: MaterializedReport,
  policy?: ReportLifecyclePolicy,
  now: Date = new Date(),
): boolean {
  const expiresAt = materialized.expires_at ?? materialized.metadata?.lifecycle?.expires_at ?? null;
  if (expiresAt) return new Date(expiresAt) <= now;

  const resolved = policy ?? resolveMaterializedReportLifecyclePolicy(materialized.target);
  if (resolved.ttl_seconds == null) return false;

  const materializedAt = lifecycleMaterializedAt(materialized);
  const computedExpiresAt = new Date(
    new Date(materializedAt).getTime() + resolved.ttl_seconds * 1000,
  );
  return computedExpiresAt <= now;
}

export function isMaterializedReportTimeStale(
  materialized: MaterializedReport,
  policy?: ReportLifecyclePolicy,
  now: Date = new Date(),
): boolean {
  if (materialized.status === MATERIALIZED_REPORT_STATUS.stale) return true;

  const staleAfterAt = lifecycleStaleAfterAt(materialized);
  if (staleAfterAt) return new Date(staleAfterAt) <= now;

  const resolved = policy ?? resolveMaterializedReportLifecyclePolicy(materialized.target);
  if (resolved.stale_after_seconds == null) return false;

  const materializedAt = lifecycleMaterializedAt(materialized);
  const computedStaleAfterAt = new Date(
    new Date(materializedAt).getTime() + resolved.stale_after_seconds * 1000,
  );
  return computedStaleAfterAt <= now;
}

export function isMaterializedReportVersionStale(
  materialized: MaterializedReport,
  snapshotVersion: number,
): boolean {
  return (
    materialized.status === MATERIALIZED_REPORT_STATUS.ready
    && materialized.version !== snapshotVersion
  );
}

export function isMaterializedReportStale(
  materialized: MaterializedReport,
  snapshotVersion: number,
  policy?: ReportLifecyclePolicy,
  now: Date = new Date(),
): boolean {
  if (materialized.status === MATERIALIZED_REPORT_STATUS.stale) return true;
  return (
    isMaterializedReportVersionStale(materialized, snapshotVersion)
    || isMaterializedReportTimeStale(materialized, policy, now)
    || isMaterializedReportExpired(materialized, policy, now)
  );
}

export function shouldRegenerateMaterializedReport(
  materialized: MaterializedReport,
  snapshotVersion: number,
  policy?: ReportLifecyclePolicy,
  now: Date = new Date(),
): boolean {
  const resolved = policy ?? resolveMaterializedReportLifecyclePolicy(materialized.target);
  if (resolved.regeneration_strategy === REPORT_LIFECYCLE_REGENERATION_STRATEGY.manual) {
    return false;
  }
  if (!isMaterializedReportStale(materialized, snapshotVersion, resolved, now)) {
    return false;
  }
  return (
    resolved.regeneration_strategy === REPORT_LIFECYCLE_REGENERATION_STRATEGY.lazyOnAccess
    || resolved.regeneration_strategy === REPORT_LIFECYCLE_REGENERATION_STRATEGY.backgroundReady
  );
}

export function evaluateMaterializedReportLifecycle(
  materialized: MaterializedReport,
  snapshotVersion: number,
  policyOverrides: ReportLifecyclePolicyOverrides = {},
  now: Date = new Date(),
): MaterializedReportLifecycleEvaluation {
  const policy = resolveMaterializedReportLifecyclePolicy(materialized.target, policyOverrides);
  const expired = isMaterializedReportExpired(materialized, policy, now);
  const timeStale = isMaterializedReportTimeStale(materialized, policy, now);
  const versionStale = isMaterializedReportVersionStale(materialized, snapshotVersion);
  const stale = expired || timeStale || versionStale || materialized.status === MATERIALIZED_REPORT_STATUS.stale;
  const shouldRegenerate = shouldRegenerateMaterializedReport(materialized, snapshotVersion, policy, now);

  return {
    materialized_id: materialized.materialized_id,
    target: materialized.target,
    expired,
    time_stale: timeStale,
    version_stale: versionStale,
    stale,
    should_regenerate: shouldRegenerate,
    recommend_lazy_regeneration:
      shouldRegenerate
      && policy.regeneration_strategy === REPORT_LIFECYCLE_REGENERATION_STRATEGY.lazyOnAccess,
  };
}

export function collectLifecycleActions(args: {
  materialized: readonly MaterializedReport[];
  snapshotVersion: number;
  policyOverrides?: ReportLifecyclePolicyOverrides;
  now?: Date;
}): ReportLifecycleAction[] {
  const now = args.now ?? new Date();
  const actions: ReportLifecycleAction[] = [];
  const seen = new Set<string>();

  function push(action: ReportLifecycleAction): void {
    const key = `${action.type}:${action.materialized_id}`;
    if (seen.has(key)) return;
    seen.add(key);
    actions.push(action);
  }

  for (const row of args.materialized) {
    const policy = resolveMaterializedReportLifecyclePolicy(row.target, args.policyOverrides);
    const evaluation = evaluateMaterializedReportLifecycle(
      row,
      args.snapshotVersion,
      args.policyOverrides,
      now,
    );

    if (evaluation.version_stale && row.status === MATERIALIZED_REPORT_STATUS.ready) {
      push({
        type: REPORT_LIFECYCLE_ACTION_TYPE.markStale,
        materialized_id: row.materialized_id,
        target: row.target,
        reason: 'version_mismatch',
      });
    }

    if (evaluation.time_stale && row.status === MATERIALIZED_REPORT_STATUS.ready) {
      push({
        type: REPORT_LIFECYCLE_ACTION_TYPE.markStale,
        materialized_id: row.materialized_id,
        target: row.target,
        reason: 'time_stale',
      });
    }

    if (evaluation.expired) {
      if (
        row.status === MATERIALIZED_REPORT_STATUS.ready
        && policy.cleanup_strategy === REPORT_LIFECYCLE_CLEANUP_STRATEGY.markStale
      ) {
        push({
          type: REPORT_LIFECYCLE_ACTION_TYPE.markStale,
          materialized_id: row.materialized_id,
          target: row.target,
          reason: 'expired',
        });
      }
      if (policy.cleanup_strategy === REPORT_LIFECYCLE_CLEANUP_STRATEGY.delete) {
        push({
          type: REPORT_LIFECYCLE_ACTION_TYPE.cleanup,
          materialized_id: row.materialized_id,
          target: row.target,
          cleanup_strategy: policy.cleanup_strategy,
        });
      }
    }

    if (evaluation.should_regenerate) {
      push({
        type: REPORT_LIFECYCLE_ACTION_TYPE.lazyRegenerate,
        materialized_id: row.materialized_id,
        snapshot_id: row.snapshot_id,
        target: row.target,
        regeneration_strategy: policy.regeneration_strategy,
      });
    }
  }

  return actions;
}
