import type { ReportPipelineReadiness } from './report-pipeline-readiness';

export class ReportPipelineNotReadyError extends Error {
  readonly code = 'report_pipeline_not_ready' as const;

  constructor(public readonly readiness: ReportPipelineReadiness) {
    super('report_pipeline_not_ready');
    this.name = 'ReportPipelineNotReadyError';
  }
}
