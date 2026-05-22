import { supabase } from '@/lib/supabase';
import { isReportDebugNonProduction } from './report-debug-access';
import {
  buildReportGatewayPath,
  REPORT_GATEWAY_RU_BASE,
  type ReportGatewaySurface,
} from './report-gateway-paths';
import {
  buildReportPipelineHealth,
  REPORT_PIPELINE_HEALTH_CHECK,
  REPORT_PIPELINE_HEALTH_CHECK_SEVERITY,
  type ReportPipelineEnvPresence,
  type ReportPipelineHealth,
  type ReportPipelineHealthCheckId,
  type ReportPipelineHealthCheckResult,
  type ReportPipelineHealthEnvMetadata,
} from './report-pipeline-health';

export type ReportPipelineRepositoryProbe = {
  id: ReportPipelineHealthCheckId;
  table: string;
  column: string;
};

export const REPORT_PIPELINE_REPOSITORY_PROBES: readonly ReportPipelineRepositoryProbe[] = [
  {
    id: REPORT_PIPELINE_HEALTH_CHECK.artifact_repository,
    table: 'location_report_artifacts',
    column: 'request_id',
  },
  {
    id: REPORT_PIPELINE_HEALTH_CHECK.snapshot_repository,
    table: 'location_report_snapshots',
    column: 'snapshot_id',
  },
  {
    id: REPORT_PIPELINE_HEALTH_CHECK.delivery_repository,
    table: 'location_report_deliveries',
    column: 'request_id',
  },
  {
    id: REPORT_PIPELINE_HEALTH_CHECK.entitlement_repository,
    table: 'location_report_access_entitlements',
    column: 'entitlement_id',
  },
  {
    id: REPORT_PIPELINE_HEALTH_CHECK.materialized_repository,
    table: 'location_report_materialized',
    column: 'materialized_id',
  },
  {
    id: REPORT_PIPELINE_HEALTH_CHECK.audit_repository,
    table: 'location_report_audit_events',
    column: 'event_id',
  },
];

export type ReportPipelineTableProbe = (
  table: string,
  column: string,
) => Promise<void>;

export type CheckReportPipelineHealthOptions = {
  now?: Date;
  probeTable?: ReportPipelineTableProbe;
  repositoryProbes?: readonly ReportPipelineRepositoryProbe[];
};

function envPresence(value: string | undefined): ReportPipelineEnvPresence {
  return value?.trim() ? 'present' : 'missing';
}

function buildEnvMetadata(): ReportPipelineHealthEnvMetadata {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  return {
    supabase_url: envPresence(supabaseUrl),
    supabase_service_role_key: envPresence(process.env.SUPABASE_SERVICE_ROLE_KEY),
    report_debug_token: envPresence(process.env.REPORT_DEBUG_TOKEN),
    location_report_manual_confirm_key: envPresence(
      process.env.LOCATION_REPORT_MANUAL_CONFIRM_KEY,
    ),
    node_env: process.env.NODE_ENV ?? 'unknown',
  };
}

function isSupabaseConfigured(metadata: ReportPipelineHealthEnvMetadata): boolean {
  return (
    metadata.supabase_url === 'present' &&
    metadata.supabase_service_role_key === 'present'
  );
}

async function defaultProbeTable(table: string, column: string): Promise<void> {
  const { error } = await supabase.from(table).select(column).limit(0);
  if (error) throw new Error(error.message);
}

function checkGatewayPaths(): ReportPipelineHealthCheckResult {
  const probeId = '__report_pipeline_health_probe__';
  const surfaces: ReportGatewaySurface[] = ['full', 'preview', 'pdf'];
  try {
    if (REPORT_GATEWAY_RU_BASE !== '/ru/report') {
      return {
        id: REPORT_PIPELINE_HEALTH_CHECK.gateway_paths,
        ok: false,
        message: 'gateway_base_mismatch',
      };
    }
    for (const surface of surfaces) {
      const path = buildReportGatewayPath(probeId, surface);
      if (!path.startsWith(`${REPORT_GATEWAY_RU_BASE}/`)) {
        return {
          id: REPORT_PIPELINE_HEALTH_CHECK.gateway_paths,
          ok: false,
          message: `gateway_path_invalid:${surface}`,
        };
      }
    }
    return { id: REPORT_PIPELINE_HEALTH_CHECK.gateway_paths, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: REPORT_PIPELINE_HEALTH_CHECK.gateway_paths,
      ok: false,
      message,
    };
  }
}

function checkDebugGuard(): ReportPipelineHealthCheckResult {
  if (isReportDebugNonProduction()) {
    return { id: REPORT_PIPELINE_HEALTH_CHECK.debug_guard, ok: true };
  }
  if (process.env.REPORT_DEBUG_TOKEN?.trim()) {
    return { id: REPORT_PIPELINE_HEALTH_CHECK.debug_guard, ok: true };
  }
  return {
    id: REPORT_PIPELINE_HEALTH_CHECK.debug_guard,
    ok: false,
    severity: REPORT_PIPELINE_HEALTH_CHECK_SEVERITY.warning,
    message: 'report_debug_token_missing_in_production',
  };
}

async function checkRepositoryProbe(
  probe: ReportPipelineRepositoryProbe,
  probeTable: ReportPipelineTableProbe,
  supabaseReady: boolean,
): Promise<ReportPipelineHealthCheckResult> {
  if (!supabaseReady) {
    return {
      id: probe.id,
      ok: false,
      message: 'supabase_env_missing',
    };
  }
  try {
    await probeTable(probe.table, probe.column);
    return { id: probe.id, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id: probe.id, ok: false, message };
  }
}

export async function checkReportPipelineHealth(
  options: CheckReportPipelineHealthOptions = {},
): Promise<ReportPipelineHealth> {
  const checkedAt = (options.now ?? new Date()).toISOString();
  const metadata = { env: buildEnvMetadata() };
  const supabaseReady = isSupabaseConfigured(metadata.env);
  const probeTable = options.probeTable ?? defaultProbeTable;
  const repositoryProbes = options.repositoryProbes ?? REPORT_PIPELINE_REPOSITORY_PROBES;

  const repositoryChecks = await Promise.all(
    repositoryProbes.map(probe =>
      checkRepositoryProbe(probe, probeTable, supabaseReady),
    ),
  );

  const checks: ReportPipelineHealthCheckResult[] = [
    ...repositoryChecks,
    checkGatewayPaths(),
    checkDebugGuard(),
  ];

  return buildReportPipelineHealth({
    checked_at: checkedAt,
    checks,
    metadata,
  });
}
