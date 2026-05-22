export const REPORT_PIPELINE_HEALTH_STATUS = {
  healthy: 'healthy',
  degraded: 'degraded',
  failing: 'failing',
} as const;

export const REPORT_PIPELINE_HEALTH_STATUSES = [
  REPORT_PIPELINE_HEALTH_STATUS.healthy,
  REPORT_PIPELINE_HEALTH_STATUS.degraded,
  REPORT_PIPELINE_HEALTH_STATUS.failing,
] as const;

export type ReportPipelineHealthStatus =
  (typeof REPORT_PIPELINE_HEALTH_STATUSES)[number];

export const REPORT_PIPELINE_HEALTH_CHECK = {
  artifact_repository: 'artifact_repository',
  snapshot_repository: 'snapshot_repository',
  delivery_repository: 'delivery_repository',
  entitlement_repository: 'entitlement_repository',
  materialized_repository: 'materialized_repository',
  audit_repository: 'audit_repository',
  gateway_paths: 'gateway_paths',
  debug_guard: 'debug_guard',
} as const;

export const REPORT_PIPELINE_HEALTH_CHECKS = [
  REPORT_PIPELINE_HEALTH_CHECK.artifact_repository,
  REPORT_PIPELINE_HEALTH_CHECK.snapshot_repository,
  REPORT_PIPELINE_HEALTH_CHECK.delivery_repository,
  REPORT_PIPELINE_HEALTH_CHECK.entitlement_repository,
  REPORT_PIPELINE_HEALTH_CHECK.materialized_repository,
  REPORT_PIPELINE_HEALTH_CHECK.audit_repository,
  REPORT_PIPELINE_HEALTH_CHECK.gateway_paths,
  REPORT_PIPELINE_HEALTH_CHECK.debug_guard,
] as const;

export type ReportPipelineHealthCheckId =
  (typeof REPORT_PIPELINE_HEALTH_CHECKS)[number];

export const REPORT_PIPELINE_HEALTH_CHECK_SEVERITY = {
  error: 'error',
  warning: 'warning',
} as const;

export type ReportPipelineHealthCheckSeverity =
  (typeof REPORT_PIPELINE_HEALTH_CHECK_SEVERITY)[keyof typeof REPORT_PIPELINE_HEALTH_CHECK_SEVERITY];

export type ReportPipelineHealthCheckResult = {
  id: ReportPipelineHealthCheckId;
  ok: boolean;
  severity?: ReportPipelineHealthCheckSeverity;
  message?: string;
};

export type ReportPipelineEnvPresence = 'present' | 'missing';

export type ReportPipelineHealthEnvMetadata = {
  supabase_url: ReportPipelineEnvPresence;
  supabase_service_role_key: ReportPipelineEnvPresence;
  report_debug_token: ReportPipelineEnvPresence;
  location_report_manual_confirm_key: ReportPipelineEnvPresence;
  node_env: string;
};

export type ReportPipelineHealthMetadata = {
  env: ReportPipelineHealthEnvMetadata;
};

export type ReportPipelineHealth = {
  status: ReportPipelineHealthStatus;
  checked_at: string;
  checks: ReportPipelineHealthCheckResult[];
  warnings: string[];
  failures: string[];
  metadata: ReportPipelineHealthMetadata;
};

export function resolveReportPipelineHealthStatus(input: {
  failures: string[];
  warnings: string[];
}): ReportPipelineHealthStatus {
  if (input.failures.length > 0) return REPORT_PIPELINE_HEALTH_STATUS.failing;
  if (input.warnings.length > 0) return REPORT_PIPELINE_HEALTH_STATUS.degraded;
  return REPORT_PIPELINE_HEALTH_STATUS.healthy;
}

export function collectReportPipelineHealthMessages(
  checks: ReportPipelineHealthCheckResult[],
): { warnings: string[]; failures: string[] } {
  const warnings: string[] = [];
  const failures: string[] = [];
  for (const check of checks) {
    if (check.ok) continue;
    const message = check.message ?? check.id;
    if (check.severity === REPORT_PIPELINE_HEALTH_CHECK_SEVERITY.warning) {
      warnings.push(message);
    } else {
      failures.push(message);
    }
  }
  return { warnings, failures };
}

export function buildReportPipelineHealth(input: {
  checked_at: string;
  checks: ReportPipelineHealthCheckResult[];
  metadata: ReportPipelineHealthMetadata;
}): ReportPipelineHealth {
  const { warnings, failures } = collectReportPipelineHealthMessages(input.checks);
  return {
    status: resolveReportPipelineHealthStatus({ warnings, failures }),
    checked_at: input.checked_at,
    checks: input.checks,
    warnings,
    failures,
    metadata: input.metadata,
  };
}
