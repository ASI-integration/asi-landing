import type { AsiRuntimeSnapshotRow, PublicAsiRuntimeSnapshot } from './types';

export const RUNTIME_SNAPSHOT_SELECT_COLUMNS =
  'user_id, task_id, task_title, status, current_stage, completed_steps, total_steps, progress_percent, provider, attempt_number, commit_sha, pull_request_url, verification_status, last_event, started_at, updated_at, payload_version';

const FORBIDDEN_RESPONSE_KEYS = new Set([
  'userId',
  'user_id',
  'token',
  'secret',
  'password',
  'env',
  'environment',
  'command',
  'cwd',
  'absolutePath',
  'absolute_path',
  'payload',
  'rawPayload',
  'raw_payload',
  'internalFiles',
  'internal_files',
]);

export function toPublicRuntimeSnapshot(row: AsiRuntimeSnapshotRow): PublicAsiRuntimeSnapshot {
  return {
    taskId: row.task_id,
    taskTitle: row.task_title,
    status: row.status,
    currentStage: row.current_stage,
    completedSteps: row.completed_steps,
    totalSteps: row.total_steps,
    progressPercent: row.progress_percent,
    provider: row.provider,
    attemptNumber: row.attempt_number,
    commitSha: row.commit_sha,
    pullRequestUrl: row.pull_request_url,
    verificationStatus: row.verification_status,
    lastEvent: row.last_event,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    payloadVersion: row.payload_version,
  };
}

export function assertPublicRuntimeSnapshotSafe(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_RESPONSE_KEYS.has(key)) {
      throw new Error(`Forbidden runtime snapshot field: ${key}`);
    }
  }
}
