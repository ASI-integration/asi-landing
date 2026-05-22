import {
  buildReportPipelineReadiness,
  buildSupabaseEnvReadinessCheck,
  mapHealthCheckToReadinessCheck,
  type ReportPipelineReadiness,
} from './report-pipeline-readiness';
import {
  checkReportPipelineHealth,
  type CheckReportPipelineHealthOptions,
} from './report-pipeline-health-resolver';

export type CheckReportPipelineReadinessOptions = CheckReportPipelineHealthOptions;

export async function checkReportPipelineReadiness(
  options: CheckReportPipelineReadinessOptions = {},
): Promise<ReportPipelineReadiness> {
  const health = await checkReportPipelineHealth(options);
  const supabaseEnvCheck = buildSupabaseEnvReadinessCheck(health.metadata.env);
  const checks = [
    supabaseEnvCheck,
    ...health.checks.map(mapHealthCheckToReadinessCheck),
  ];

  const blockers = [...health.failures];
  if (!supabaseEnvCheck.ok && supabaseEnvCheck.message) {
    blockers.unshift(supabaseEnvCheck.message);
  }

  return buildReportPipelineReadiness({
    checked_at: health.checked_at,
    checks,
    blockers,
    warnings: health.warnings,
    metadata: health.metadata,
  });
}
