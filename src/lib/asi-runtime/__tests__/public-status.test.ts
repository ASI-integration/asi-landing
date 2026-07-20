import { describe, expect, it } from 'vitest';
import { assertPublicRuntimeSnapshotSafe, toPublicRuntimeSnapshot } from '../public-status';
import type { AsiRuntimeSnapshotRow } from '../types';

const sampleRow: AsiRuntimeSnapshotRow = {
  user_id: 'user-1',
  task_id: 'task-42',
  task_title: 'Runtime task',
  status: 'running',
  current_stage: 'verify',
  completed_steps: 1,
  total_steps: 4,
  progress_percent: 25,
  provider: 'cursor',
  attempt_number: 2,
  commit_sha: 'deadbeef',
  pull_request_url: 'https://github.com/example/repo/pull/1',
  verification_status: 'pending',
  last_event: 'step_done',
  started_at: '2026-07-20T09:00:00.000Z',
  updated_at: '2026-07-20T10:00:00.000Z',
  payload_version: 1,
};

describe('asi-runtime public-status', () => {
  it('maps stored rows to a safe public snapshot shape', () => {
    const snapshot = toPublicRuntimeSnapshot(sampleRow);

    expect(snapshot).toEqual({
      taskId: 'task-42',
      taskTitle: 'Runtime task',
      status: 'running',
      currentStage: 'verify',
      completedSteps: 1,
      totalSteps: 4,
      progressPercent: 25,
      provider: 'cursor',
      attemptNumber: 2,
      commitSha: 'deadbeef',
      pullRequestUrl: 'https://github.com/example/repo/pull/1',
      verificationStatus: 'pending',
      lastEvent: 'step_done',
      startedAt: '2026-07-20T09:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
      payloadVersion: 1,
    });
    expect(snapshot).not.toHaveProperty('userId');
    assertPublicRuntimeSnapshotSafe(snapshot);
  });
});
