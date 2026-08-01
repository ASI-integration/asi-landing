export const RUNTIME_BRIDGE_CHAT_OPERATIONS = [
  'runtime_submit_task',
  'runtime_get_task',
  'runtime_get_result',
  'runtime_list_owner_gates',
  'runtime_submit_owner_decision',
] as const;

export type RuntimeBridgeChatOperation = typeof RUNTIME_BRIDGE_CHAT_OPERATIONS[number];
export type RuntimeBridgeTaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_owner'
  | 'completed'
  | 'failed';

export type RuntimeBridgeTaskRequest = {
  title: string;
  objective: string;
  instructions: string[];
  acceptanceCriteria?: string[];
  safetyConstraints?: string[];
  repository: 'ASI-integration/asi-landing';
  baselineSha: string;
};

export type RuntimeBridgeOwnerGateRequest = {
  schemaVersion: 'asi.runtime.owner-gate.v1';
  action: string;
  exactTarget: string;
  identity: string;
  reason: string;
  evidence: string[];
  allowedSideEffect: string;
  rollback: string;
  postActionVerification: string[];
  taskCycle: string;
  expiresAt: string;
};

export type RuntimeBridgeSafeResult = {
  schemaVersion: 'asi.runtime.result.v1';
  status: 'completed' | 'failed';
  summary: string;
  changedFiles: string[];
  checks: Array<{ name: string; status: 'PASS' | 'FAIL' | 'SKIP'; detail?: string }>;
  artifacts: Array<{ type: 'commit' | 'pull_request' | 'report'; value: string }>;
  blockers: string[];
};

export type RuntimeBridgeTaskView = {
  taskId: string;
  chatgptTaskId: string;
  conversationId: string;
  status: RuntimeBridgeTaskStatus;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeBridgeOwnerGateView = RuntimeBridgeOwnerGateRequest & {
  gateId: string;
  taskId: string;
  status: 'pending' | 'approved' | 'rejected' | 'consumed' | 'expired';
  createdAt: string;
};

export type RuntimeBridgeChatInput =
  | {
      operation: 'runtime_submit_task';
      input: {
        chatgptTaskId: string;
        conversationId: string;
        idempotencyKey: string;
        task: RuntimeBridgeTaskRequest;
      };
    }
  | { operation: 'runtime_get_task'; input: { taskId: string } }
  | { operation: 'runtime_get_result'; input: { taskId: string } }
  | { operation: 'runtime_list_owner_gates'; input: Record<string, never> }
  | {
      operation: 'runtime_submit_owner_decision';
      input: {
        taskId: string;
        gateId: string;
        decisionId: string;
        taskCycle: string;
        decision: 'approved' | 'rejected';
        source: 'explicit_owner_message';
        note?: string;
      };
    };

export type RuntimeBridgeRunnerInput =
  | { operation: 'runner_claim_task'; input: { runnerId: string; leaseSeconds: number } }
  | {
      operation: 'runner_heartbeat';
      input: { runnerId: string; taskId: string; leaseToken: string; leaseSeconds: number };
    }
  | {
      operation: 'runner_submit_result';
      input: { runnerId: string; taskId: string; leaseToken: string; result: RuntimeBridgeSafeResult };
    }
  | {
      operation: 'runner_submit_owner_gate';
      input: { runnerId: string; taskId: string; leaseToken: string; gate: RuntimeBridgeOwnerGateRequest };
    }
  | {
      operation: 'runner_fail_task';
      input: { runnerId: string; taskId: string; leaseToken: string; retryable: boolean; errorCode: string };
    };
