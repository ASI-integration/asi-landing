export type AsiRuntimeSnapshotRow = {
  user_id: string;
  task_id: string;
  task_title: string;
  status: string;
  current_stage: string;
  completed_steps: number;
  total_steps: number;
  progress_percent: number;
  provider: string;
  attempt_number: number;
  commit_sha: string | null;
  pull_request_url: string | null;
  verification_status: string;
  last_event: string;
  started_at: string;
  updated_at: string;
  payload_version: number;
};

export type PublicAsiRuntimeSnapshot = {
  taskId: string;
  taskTitle: string;
  status: string;
  currentStage: string;
  completedSteps: number;
  totalSteps: number;
  progressPercent: number;
  provider: string;
  attemptNumber: number;
  commitSha: string | null;
  pullRequestUrl: string | null;
  verificationStatus: string;
  lastEvent: string;
  startedAt: string;
  updatedAt: string;
  payloadVersion: number;
};

export type AsiRuntimeStatusResponse =
  | {
      ok: true;
      connected: false;
      message: string;
    }
  | {
      ok: true;
      connected: true;
      snapshot: PublicAsiRuntimeSnapshot;
    };
