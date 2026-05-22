import type {
  ReportPipelineHealthCheckId,
  ReportPipelineHealthCheckResult,
  ReportPipelineHealthEnvMetadata,
  ReportPipelineHealthMetadata,
} from './report-pipeline-health';

export const REPORT_PIPELINE_READINESS_CHECK = {
  supabase_env: 'supabase_env',
} as const;

export type ReportPipelineReadinessSupabaseCheckId =
  (typeof REPORT_PIPELINE_READINESS_CHECK)['supabase_env'];

export type ReportPipelineReadinessCheckId =
  | ReportPipelineHealthCheckId
  | ReportPipelineReadinessSupabaseCheckId;

export type ReportPipelineReadinessCheckResult = {
  id: ReportPipelineReadinessCheckId;
  ok: boolean;
  message?: string;
};

export type ReportPipelineReadinessMetadata = ReportPipelineHealthMetadata;

export type ReportPipelineReadiness = {
  ready: boolean;
  checked_at: string;
  blockers: string[];
  warnings: string[];
  checks: ReportPipelineReadinessCheckResult[];
  metadata: ReportPipelineReadinessMetadata;
};

export const REPORT_PIPELINE_NOT_READY_PUBLIC_MESSAGE =
  'Оплата прошла, но отчёт временно не может быть сформирован. Мы сохранили заявку и вернёмся к формированию после восстановления сервиса.';

export function isReportPipelineSupabaseEnvReady(
  env: ReportPipelineHealthEnvMetadata,
): boolean {
  return (
    env.supabase_url === 'present' && env.supabase_service_role_key === 'present'
  );
}

export function buildSupabaseEnvReadinessCheck(
  env: ReportPipelineHealthEnvMetadata,
): ReportPipelineReadinessCheckResult {
  if (isReportPipelineSupabaseEnvReady(env)) {
    return { id: REPORT_PIPELINE_READINESS_CHECK.supabase_env, ok: true };
  }
  return {
    id: REPORT_PIPELINE_READINESS_CHECK.supabase_env,
    ok: false,
    message: 'supabase_env_missing',
  };
}

export function mapHealthCheckToReadinessCheck(
  check: ReportPipelineHealthCheckResult,
): ReportPipelineReadinessCheckResult {
  return {
    id: check.id,
    ok: check.ok,
    ...(check.message ? { message: check.message } : {}),
  };
}

export function buildReportPipelineReadiness(input: {
  checked_at: string;
  checks: ReportPipelineReadinessCheckResult[];
  blockers: string[];
  warnings: string[];
  metadata: ReportPipelineReadinessMetadata;
}): ReportPipelineReadiness {
  const blockers = [...new Set(input.blockers)];
  const warnings = [...new Set(input.warnings)];
  return {
    ready: blockers.length === 0,
    checked_at: input.checked_at,
    blockers,
    warnings,
    checks: input.checks,
    metadata: input.metadata,
  };
}

/** Public API shape for 503 — no env metadata or internal check messages. */
export function toReportPipelineNotReadyPayload(_readiness: ReportPipelineReadiness) {
  return {
    error: 'report_pipeline_not_ready' as const,
    ready: false,
    retryable: true,
    message: REPORT_PIPELINE_NOT_READY_PUBLIC_MESSAGE,
  };
}
