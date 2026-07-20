import { supabase } from '@/lib/supabase';
import { RUNTIME_SNAPSHOT_SELECT_COLUMNS } from './public-status';
import type { RuntimeSnapshotIngestPayload } from './ingest-schema';
import type { AsiRuntimeSnapshotRow } from './types';

export type RuntimeSnapshotUpsertInput = RuntimeSnapshotIngestPayload & {
  userId: string;
};

export async function upsertRuntimeSnapshot(input: RuntimeSnapshotUpsertInput): Promise<AsiRuntimeSnapshotRow> {
  const userId = input.userId.trim();
  if (!userId) throw new Error('Runtime owner user id is not configured.');

  const { data, error } = await supabase
    .from('asi_runtime_snapshots')
    .upsert({
      user_id: userId,
      task_id: input.taskId,
      task_title: input.taskTitle,
      status: input.status,
      current_stage: input.currentStage,
      completed_steps: input.completedSteps,
      total_steps: input.totalSteps,
      progress_percent: input.progressPercent,
      provider: input.provider,
      attempt_number: input.attemptNumber,
      commit_sha: input.commitSha,
      pull_request_url: input.pullRequestUrl,
      verification_status: input.verificationStatus,
      last_event: input.lastEvent,
      started_at: input.startedAt,
      payload_version: input.payloadVersion,
    }, { onConflict: 'user_id' })
    .select(RUNTIME_SNAPSHOT_SELECT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as AsiRuntimeSnapshotRow;
}

export async function getRuntimeSnapshotForUser(userId: string): Promise<AsiRuntimeSnapshotRow | null> {
  const id = userId.trim();
  if (!id) return null;

  const { data, error } = await supabase
    .from('asi_runtime_snapshots')
    .select(RUNTIME_SNAPSHOT_SELECT_COLUMNS)
    .eq('user_id', id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return data as AsiRuntimeSnapshotRow;
}
