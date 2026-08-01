import 'server-only';
import { createHash } from 'node:crypto';

const SHA = /^[0-9a-f]{40}$/;
const OWNER_GATE_KEYS = [
  'schemaVersion',
  'taskId',
  'status',
  'action',
  'target',
  'identity',
  'allowedSideEffect',
  'postActionVerification',
  'authorization',
  'typedConfirmation',
] as const;

export const OWNER_DECISION_BUS_ISSUE_NUMBER = 106;
export const CONTROL_CENTER_OWNER_GATE_MERGE_BLOCK_PASSED =
  'CONTROL_CENTER_OWNER_GATE_MERGE_BLOCK_PASSED';

export type ControlCenterOwnerGateState =
  | 'pending'
  | 'passed'
  | 'failed'
  | 'stale_sha'
  | 'head_changed';

export type ControlCenterMergeState = 'blocked' | 'merge_allowed';

export type OwnerDecisionBusRecord = {
  sourceId: string;
  body: string;
};

type CanonicalOwnerGateStatus = 'missing' | 'approved' | 'rejected' | 'expired' | 'consumed';

type CanonicalOwnerGate = {
  schemaVersion: 'asi.agent-os.owner-gate.v1';
  taskId: string;
  status: CanonicalOwnerGateStatus;
  action: 'merge';
  target: string;
  identity: { ref?: string; sha: string };
  allowedSideEffect: string;
  postActionVerification: string[];
  authorization: null | {
    source: 'explicit_owner_message';
    owner: 'Nikolay';
    scope: string;
    taskCycle: string;
  };
  typedConfirmation: {
    present: boolean;
    countsAsOwnerApproval: false;
  };
};

type CanonicalConsumption = {
  taskId: string;
  status: 'consumed';
  action: 'merge';
  target: string;
  approvedHeadSha: string;
};

export type ControlCenterMergeBlocker = {
  code:
    | 'owner_gate_pending'
    | 'owner_gate_failed'
    | 'owner_gate_consumed'
    | 'owner_gate_stale_sha'
    | 'pull_request_head_changed'
    | 'owner_gate_conflict'
    | 'owner_gate_unavailable'
    | 'merge_provider_not_configured'
    | 'merge_provider_rejected';
  message: string;
  repository: string;
  pullRequestNumber: number;
  expectedSha: string;
  currentSha: string;
  approvedSha: string | null;
  approvalTaskId: string | null;
};

export type ControlCenterMergeGateView = {
  gateState: ControlCenterOwnerGateState;
  mergeState: ControlCenterMergeState;
  repository: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  expectedSha: string;
  currentSha: string;
  approvedSha: string | null;
  approvalTaskId: string | null;
  approvalSourceId: string | null;
  mergeRequestId: string;
  blocker: ControlCenterMergeBlocker | null;
  merged: boolean;
  mergeCommitSha: string | null;
};

export type ControlCenterPullRequest = {
  repository: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  headSha: string;
  merged: boolean;
  mergeCommitSha: string | null;
};

export type ControlCenterMergeOutcome = {
  gate: ControlCenterMergeGateView;
  merged: boolean;
  deduplicated: boolean;
  mergeCommitSha: string | null;
};

export type ControlCenterMergeDependencies = {
  loadPullRequest: (pullRequestUrl: string) => Promise<ControlCenterPullRequest>;
  loadOwnerDecisionRecords: (
    pullRequest: ControlCenterPullRequest,
  ) => Promise<OwnerDecisionBusRecord[]>;
  mergePullRequest: (
    pullRequest: ControlCenterPullRequest,
    exactHeadSha: string,
  ) => Promise<{ merged: true; deduplicated: boolean; mergeCommitSha: string | null }>;
};

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyText);
}

function parseOwnerGate(value: unknown): CanonicalOwnerGate | null {
  if (!object(value) || !exactKeys(value, OWNER_GATE_KEYS)) return null;
  if (value.schemaVersion !== 'asi.agent-os.owner-gate.v1') return null;
  if (!nonEmptyText(value.taskId) || value.action !== 'merge' || !nonEmptyText(value.target)) return null;
  if (!['missing', 'approved', 'rejected', 'expired', 'consumed'].includes(String(value.status))) return null;
  if (!object(value.identity) || !SHA.test(String(value.identity.sha ?? ''))) return null;
  if (value.identity.ref !== undefined && !nonEmptyText(value.identity.ref)) return null;
  if (!nonEmptyText(value.allowedSideEffect) || !stringList(value.postActionVerification)) return null;
  if (!object(value.typedConfirmation)
    || !exactKeys(value.typedConfirmation, ['present', 'countsAsOwnerApproval'])
    || typeof value.typedConfirmation.present !== 'boolean'
    || value.typedConfirmation.countsAsOwnerApproval !== false) return null;

  if (value.status === 'approved') {
    if (!object(value.authorization)
      || !exactKeys(value.authorization, ['source', 'owner', 'scope', 'taskCycle'])
      || value.authorization.source !== 'explicit_owner_message'
      || value.authorization.owner !== 'Nikolay'
      || !nonEmptyText(value.authorization.scope)
      || !nonEmptyText(value.authorization.taskCycle)) return null;
  } else if (value.authorization !== null) {
    return null;
  }

  return value as CanonicalOwnerGate;
}

function parseConsumption(value: unknown): CanonicalConsumption | null {
  if (!object(value)
    || value.status !== 'consumed'
    || value.action !== 'merge'
    || !nonEmptyText(value.taskId)
    || !nonEmptyText(value.target)
    || !SHA.test(String(value.approvedHeadSha ?? ''))) return null;
  return {
    taskId: value.taskId,
    status: 'consumed',
    action: 'merge',
    target: value.target,
    approvedHeadSha: String(value.approvedHeadSha),
  };
}

function jsonValues(body: string): unknown[] {
  const values: unknown[] = [];
  const fenced = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenced.exec(body)) !== null) {
    try {
      values.push(JSON.parse(match[1]));
    } catch {
      // Invalid comment blocks are not canonical artifacts.
    }
  }
  const trimmed = body.trim();
  if (values.length === 0 && trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      values.push(JSON.parse(trimmed));
    } catch {
      // Invalid standalone JSON is ignored fail-closed.
    }
  }
  return values;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (object(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requestId(repository: string, pullRequestNumber: number, sha: string): string {
  const digest = createHash('sha256')
    .update(`${repository}#${pullRequestNumber}@${sha}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `control-center-merge-${digest}`;
}

function blocker(input: {
  code: ControlCenterMergeBlocker['code'];
  message: string;
  pullRequest: ControlCenterPullRequest;
  expectedSha: string;
  approvedSha?: string | null;
  approvalTaskId?: string | null;
}): ControlCenterMergeBlocker {
  return {
    code: input.code,
    message: input.message,
    repository: input.pullRequest.repository,
    pullRequestNumber: input.pullRequest.pullRequestNumber,
    expectedSha: input.expectedSha,
    currentSha: input.pullRequest.headSha,
    approvedSha: input.approvedSha ?? null,
    approvalTaskId: input.approvalTaskId ?? null,
  };
}

function blockedView(input: {
  gateState: Exclude<ControlCenterOwnerGateState, 'passed'>;
  pullRequest: ControlCenterPullRequest;
  expectedSha: string;
  approvedSha?: string | null;
  approvalTaskId?: string | null;
  approvalSourceId?: string | null;
  code: ControlCenterMergeBlocker['code'];
  message: string;
}): ControlCenterMergeGateView {
  return {
    gateState: input.gateState,
    mergeState: 'blocked',
    repository: input.pullRequest.repository,
    pullRequestNumber: input.pullRequest.pullRequestNumber,
    pullRequestUrl: input.pullRequest.pullRequestUrl,
    expectedSha: input.expectedSha,
    currentSha: input.pullRequest.headSha,
    approvedSha: input.approvedSha ?? null,
    approvalTaskId: input.approvalTaskId ?? null,
    approvalSourceId: input.approvalSourceId ?? null,
    mergeRequestId: requestId(
      input.pullRequest.repository,
      input.pullRequest.pullRequestNumber,
      input.pullRequest.headSha,
    ),
    blocker: blocker(input),
    merged: input.pullRequest.merged,
    mergeCommitSha: input.pullRequest.mergeCommitSha,
  };
}

export function unavailableControlCenterMergeGate(input: {
  pullRequest: ControlCenterPullRequest;
  expectedSha: string;
  code?: 'owner_gate_unavailable' | 'merge_provider_not_configured' | 'merge_provider_rejected';
  message: string;
}): ControlCenterMergeGateView {
  return blockedView({
    gateState: 'failed',
    pullRequest: input.pullRequest,
    expectedSha: input.expectedSha,
    code: input.code ?? 'owner_gate_unavailable',
    message: input.message,
  });
}

export function evaluateControlCenterMergeGate(input: {
  pullRequest: ControlCenterPullRequest;
  expectedSha: string;
  records: OwnerDecisionBusRecord[];
}): ControlCenterMergeGateView {
  const { pullRequest, expectedSha } = input;
  const target = `${pullRequest.repository}#${pullRequest.pullRequestNumber}`;
  const gates: Array<{ artifact: CanonicalOwnerGate; sourceId: string }> = [];
  const consumptions: CanonicalConsumption[] = [];

  for (const record of input.records) {
    for (const value of jsonValues(record.body)) {
      const gate = parseOwnerGate(value);
      if (gate?.target === target) gates.push({ artifact: gate, sourceId: record.sourceId });
      const consumption = parseConsumption(value);
      if (consumption?.target === target) consumptions.push(consumption);
    }
  }

  const byTask = new Map<string, { artifact: CanonicalOwnerGate; sourceId: string; fingerprint: string }>();
  for (const gate of gates) {
    const fingerprint = stableJson(gate.artifact);
    const prior = byTask.get(gate.artifact.taskId);
    if (prior && prior.fingerprint !== fingerprint) {
      return blockedView({
        gateState: 'failed',
        pullRequest,
        expectedSha,
        approvalTaskId: gate.artifact.taskId,
        code: 'owner_gate_conflict',
        message: 'Найдены противоречащие друг другу решения владельца.',
      });
    }
    byTask.set(gate.artifact.taskId, { ...gate, fingerprint });
  }

  const canonical = [...byTask.values()];
  const consumed = (gate: CanonicalOwnerGate) => consumptions.some((item) =>
    item.taskId === gate.taskId
    && item.target === gate.target
    && item.approvedHeadSha === gate.identity.sha,
  );

  if (!SHA.test(expectedSha) || expectedSha !== pullRequest.headSha) {
    const prior = canonical.find((item) => item.artifact.identity.sha === expectedSha);
    return blockedView({
      gateState: 'head_changed',
      pullRequest,
      expectedSha,
      approvedSha: prior?.artifact.identity.sha ?? null,
      approvalTaskId: prior?.artifact.taskId ?? null,
      approvalSourceId: prior?.sourceId ?? null,
      code: 'pull_request_head_changed',
      message: 'Состав PR изменился. Требуется новое решение владельца для текущей версии.',
    });
  }

  const exactApproved = canonical.find((item) =>
    item.artifact.status === 'approved'
    && item.artifact.identity.sha === pullRequest.headSha
    && !consumed(item.artifact),
  );
  if (exactApproved) {
    return {
      gateState: 'passed',
      mergeState: 'merge_allowed',
      repository: pullRequest.repository,
      pullRequestNumber: pullRequest.pullRequestNumber,
      pullRequestUrl: pullRequest.pullRequestUrl,
      expectedSha,
      currentSha: pullRequest.headSha,
      approvedSha: exactApproved.artifact.identity.sha,
      approvalTaskId: exactApproved.artifact.taskId,
      approvalSourceId: exactApproved.sourceId,
      mergeRequestId: requestId(pullRequest.repository, pullRequest.pullRequestNumber, pullRequest.headSha),
      blocker: null,
      merged: pullRequest.merged,
      mergeCommitSha: pullRequest.mergeCommitSha,
    };
  }

  const staleApproval = canonical.find((item) => item.artifact.status === 'approved');
  if (staleApproval) {
    if (consumed(staleApproval.artifact)) {
      return blockedView({
        gateState: 'failed',
        pullRequest,
        expectedSha,
        approvedSha: staleApproval.artifact.identity.sha,
        approvalTaskId: staleApproval.artifact.taskId,
        approvalSourceId: staleApproval.sourceId,
        code: 'owner_gate_consumed',
        message: 'Решение владельца уже использовано и не может быть применено повторно.',
      });
    }
    return blockedView({
      gateState: 'stale_sha',
      pullRequest,
      expectedSha,
      approvedSha: staleApproval.artifact.identity.sha,
      approvalTaskId: staleApproval.artifact.taskId,
      approvalSourceId: staleApproval.sourceId,
      code: 'owner_gate_stale_sha',
      message: 'Разрешение относится к другой версии PR.',
    });
  }

  const failed = canonical.find((item) => ['rejected', 'expired', 'consumed'].includes(item.artifact.status));
  if (failed) {
    return blockedView({
      gateState: 'failed',
      pullRequest,
      expectedSha,
      approvedSha: failed.artifact.identity.sha,
      approvalTaskId: failed.artifact.taskId,
      approvalSourceId: failed.sourceId,
      code: 'owner_gate_failed',
      message: 'Решение владельца не разрешает объединение PR.',
    });
  }

  return blockedView({
    gateState: 'pending',
    pullRequest,
    expectedSha,
    code: 'owner_gate_pending',
    message: 'Ожидается решение владельца для текущей версии PR.',
  });
}

export async function requestControlCenterMerge(input: {
  pullRequestUrl: string;
  expectedSha: string;
}, dependencies: ControlCenterMergeDependencies): Promise<ControlCenterMergeOutcome> {
  const pullRequest = await dependencies.loadPullRequest(input.pullRequestUrl);
  const records = await dependencies.loadOwnerDecisionRecords(pullRequest);
  const gate = evaluateControlCenterMergeGate({
    pullRequest,
    expectedSha: input.expectedSha,
    records,
  });
  if (pullRequest.merged
    && gate.blocker?.code === 'owner_gate_consumed'
    && gate.approvedSha === pullRequest.headSha
    && input.expectedSha === pullRequest.headSha) {
    return {
      gate: { ...gate, merged: true, mergeCommitSha: pullRequest.mergeCommitSha },
      merged: true,
      deduplicated: true,
      mergeCommitSha: pullRequest.mergeCommitSha,
    };
  }
  if (gate.mergeState !== 'merge_allowed') {
    return { gate, merged: false, deduplicated: false, mergeCommitSha: pullRequest.mergeCommitSha };
  }

  try {
    const merged = await dependencies.mergePullRequest(pullRequest, gate.currentSha);
    return {
      gate: { ...gate, merged: true, mergeCommitSha: merged.mergeCommitSha },
      merged: true,
      deduplicated: merged.deduplicated,
      mergeCommitSha: merged.mergeCommitSha,
    };
  } catch (error) {
    const current = await dependencies.loadPullRequest(input.pullRequestUrl);
    if (current.headSha !== gate.currentSha) {
      const changed = evaluateControlCenterMergeGate({
        pullRequest: current,
        expectedSha: gate.currentSha,
        records,
      });
      return { gate: changed, merged: false, deduplicated: false, mergeCommitSha: current.mergeCommitSha };
    }
    throw error;
  }
}
