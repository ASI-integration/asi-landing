import {
  MATERIALIZED_REPORT_TARGET,
  type MaterializedReportTarget,
} from './report-materialized';

export const REPORT_LIFECYCLE_REGENERATION_STRATEGY = {
  manual: 'manual',
  lazyOnAccess: 'lazy_on_access',
  backgroundReady: 'background_ready',
} as const;

export const REPORT_LIFECYCLE_REGENERATION_STRATEGIES = [
  REPORT_LIFECYCLE_REGENERATION_STRATEGY.manual,
  REPORT_LIFECYCLE_REGENERATION_STRATEGY.lazyOnAccess,
  REPORT_LIFECYCLE_REGENERATION_STRATEGY.backgroundReady,
] as const;

export type ReportLifecycleRegenerationStrategy =
  (typeof REPORT_LIFECYCLE_REGENERATION_STRATEGIES)[number];

export const REPORT_LIFECYCLE_CLEANUP_STRATEGY = {
  retain: 'retain',
  markStale: 'mark_stale',
  delete: 'delete',
} as const;

export const REPORT_LIFECYCLE_CLEANUP_STRATEGIES = [
  REPORT_LIFECYCLE_CLEANUP_STRATEGY.retain,
  REPORT_LIFECYCLE_CLEANUP_STRATEGY.markStale,
  REPORT_LIFECYCLE_CLEANUP_STRATEGY.delete,
] as const;

export type ReportLifecycleCleanupStrategy = (typeof REPORT_LIFECYCLE_CLEANUP_STRATEGIES)[number];

export type ReportLifecyclePolicy = {
  target: MaterializedReportTarget;
  ttl_seconds: number | null;
  stale_after_seconds: number | null;
  regeneration_strategy: ReportLifecycleRegenerationStrategy;
  auto_refresh: boolean;
  cleanup_strategy: ReportLifecycleCleanupStrategy;
};

export type ReportLifecyclePolicyOverrides = Partial<
  Record<MaterializedReportTarget, Partial<ReportLifecyclePolicy>>
>;

const PREVIEW_TTL_SECONDS = 15 * 60;
const DASHBOARD_TTL_SECONDS = 2 * 60 * 60;
const WEB_TTL_SECONDS = 24 * 60 * 60;

export const DEFAULT_REPORT_LIFECYCLE_POLICIES: Record<
  MaterializedReportTarget,
  ReportLifecyclePolicy
> = {
  [MATERIALIZED_REPORT_TARGET.preview]: {
    target: MATERIALIZED_REPORT_TARGET.preview,
    ttl_seconds: PREVIEW_TTL_SECONDS,
    stale_after_seconds: 10 * 60,
    regeneration_strategy: REPORT_LIFECYCLE_REGENERATION_STRATEGY.lazyOnAccess,
    auto_refresh: false,
    cleanup_strategy: REPORT_LIFECYCLE_CLEANUP_STRATEGY.markStale,
  },
  [MATERIALIZED_REPORT_TARGET.dashboard]: {
    target: MATERIALIZED_REPORT_TARGET.dashboard,
    ttl_seconds: DASHBOARD_TTL_SECONDS,
    stale_after_seconds: 60 * 60,
    regeneration_strategy: REPORT_LIFECYCLE_REGENERATION_STRATEGY.lazyOnAccess,
    auto_refresh: false,
    cleanup_strategy: REPORT_LIFECYCLE_CLEANUP_STRATEGY.markStale,
  },
  [MATERIALIZED_REPORT_TARGET.web]: {
    target: MATERIALIZED_REPORT_TARGET.web,
    ttl_seconds: WEB_TTL_SECONDS,
    stale_after_seconds: 12 * 60 * 60,
    regeneration_strategy: REPORT_LIFECYCLE_REGENERATION_STRATEGY.lazyOnAccess,
    auto_refresh: false,
    cleanup_strategy: REPORT_LIFECYCLE_CLEANUP_STRATEGY.retain,
  },
  [MATERIALIZED_REPORT_TARGET.pdf]: {
    target: MATERIALIZED_REPORT_TARGET.pdf,
    ttl_seconds: null,
    stale_after_seconds: null,
    regeneration_strategy: REPORT_LIFECYCLE_REGENERATION_STRATEGY.manual,
    auto_refresh: false,
    cleanup_strategy: REPORT_LIFECYCLE_CLEANUP_STRATEGY.retain,
  },
};

export function isReportLifecycleRegenerationStrategy(
  value: unknown,
): value is ReportLifecycleRegenerationStrategy {
  return (
    typeof value === 'string'
    && REPORT_LIFECYCLE_REGENERATION_STRATEGIES.includes(value as ReportLifecycleRegenerationStrategy)
  );
}

export function isReportLifecycleCleanupStrategy(
  value: unknown,
): value is ReportLifecycleCleanupStrategy {
  return (
    typeof value === 'string'
    && REPORT_LIFECYCLE_CLEANUP_STRATEGIES.includes(value as ReportLifecycleCleanupStrategy)
  );
}

export function resolveMaterializedReportLifecyclePolicy(
  target: MaterializedReportTarget,
  overrides: ReportLifecyclePolicyOverrides = {},
): ReportLifecyclePolicy {
  const base = DEFAULT_REPORT_LIFECYCLE_POLICIES[target];
  const patch = overrides[target];
  if (!patch) return base;
  return { ...base, ...patch, target };
}

export type ReportLifecycleTimestamps = {
  materialized_at: string;
  stale_after_at: string | null;
  expires_at: string | null;
};

function addSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

export function computeReportLifecycleTimestamps(
  policy: ReportLifecyclePolicy,
  materializedAt: string,
): ReportLifecycleTimestamps {
  return {
    materialized_at: materializedAt,
    stale_after_at:
      policy.stale_after_seconds == null
        ? null
        : addSeconds(materializedAt, policy.stale_after_seconds),
    expires_at:
      policy.ttl_seconds == null ? null : addSeconds(materializedAt, policy.ttl_seconds),
  };
}

export type MaterializedReportLifecycleMetadata = {
  policy_target: MaterializedReportTarget;
  regeneration_strategy: ReportLifecycleRegenerationStrategy;
  cleanup_strategy: ReportLifecycleCleanupStrategy;
  auto_refresh: boolean;
  materialized_at: string;
  stale_after_at: string | null;
  expires_at: string | null;
};

export function buildMaterializedReportLifecycleMetadata(
  policy: ReportLifecyclePolicy,
  timestamps: ReportLifecycleTimestamps,
): MaterializedReportLifecycleMetadata {
  return {
    policy_target: policy.target,
    regeneration_strategy: policy.regeneration_strategy,
    cleanup_strategy: policy.cleanup_strategy,
    auto_refresh: policy.auto_refresh,
    materialized_at: timestamps.materialized_at,
    stale_after_at: timestamps.stale_after_at,
    expires_at: timestamps.expires_at,
  };
}
