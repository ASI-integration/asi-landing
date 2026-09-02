import 'server-only';
import type { DevelopmentRepositoryDefinition } from '@/lib/development/repositories';
import { DEVELOPMENT_REPOSITORY_ALLOWLIST } from '@/lib/development/repositories';
import type {
  RuntimeRunnerCapabilityState,
  RuntimeRunnerReadinessRecord,
  RuntimeRunnerReadinessRecordV1,
  RuntimeRunnerReadinessRecordV2,
  RuntimeRunnerRepositoryEvidenceV2,
} from './bridge-types';

export const RUNNER_READINESS_V2_REPOSITORY_IDS = ['landing', 'runtime'] as const;
export type RunnerReadinessV2RepositoryId = typeof RUNNER_READINESS_V2_REPOSITORY_IDS[number];

/** Approved srv and repository-pool checkout layouts per canonical Runtime repository. */
export const RUNNER_READINESS_V2_APPROVED_CHECKOUT_PATHS = {
  landing: [
    '/srv/asi-landing',
    '/var/lib/asi-runtime/repos/asi-landing',
  ],
  runtime: [
    '/srv/asi-os-runtime',
    '/var/lib/asi-runtime/repos/asi-os-runtime',
  ],
} as const satisfies Record<RunnerReadinessV2RepositoryId, readonly string[]>;

const RUNNER_READINESS_V2_REPOSITORY_FULL_NAMES: Record<
  RunnerReadinessV2RepositoryId,
  (typeof DEVELOPMENT_REPOSITORY_ALLOWLIST)[number]['fullName']
> = {
  landing: 'ASI-integration/asi-landing',
  runtime: 'ASI-integration/asi-os-runtime',
};

export function isApprovedRunnerCheckoutPath(
  repositoryId: RunnerReadinessV2RepositoryId,
  canonicalCheckoutPath: string,
): boolean {
  return RUNNER_READINESS_V2_APPROVED_CHECKOUT_PATHS[repositoryId]
    .some((approvedPath) => approvedPath === canonicalCheckoutPath);
}

export function isRunnerRepositoryEvidenceBindingValid(
  repositoryId: unknown,
  fullName: unknown,
  canonicalCheckoutPath: unknown,
): repositoryId is RunnerReadinessV2RepositoryId {
  if (repositoryId !== 'landing' && repositoryId !== 'runtime') return false;
  if (fullName !== RUNNER_READINESS_V2_REPOSITORY_FULL_NAMES[repositoryId]) return false;
  if (typeof canonicalCheckoutPath !== 'string') return false;
  return isApprovedRunnerCheckoutPath(repositoryId, canonicalCheckoutPath);
}

const RUNNER_TO_DEVELOPMENT_REPOSITORY_ID: Record<RunnerReadinessV2RepositoryId, string> = {
  landing: 'asi-landing',
  runtime: 'asi-os-runtime',
};

const DEVELOPMENT_TO_RUNNER_REPOSITORY_ID: Record<string, RunnerReadinessV2RepositoryId> = {
  'asi-landing': 'landing',
  'asi-os-runtime': 'runtime',
};

const ALLOWED_FULL_NAMES = new Set(
  DEVELOPMENT_REPOSITORY_ALLOWLIST.map((repo) => repo.fullName),
);

export function isRuntimeRunnerReadinessV1(
  record: RuntimeRunnerReadinessRecord,
): record is RuntimeRunnerReadinessRecordV1 {
  return record.schemaVersion === 'asi.runtime.runner-readiness.v1';
}

export function isRuntimeRunnerReadinessV2(
  record: RuntimeRunnerReadinessRecord,
): record is RuntimeRunnerReadinessRecordV2 {
  return record.schemaVersion === 'asi.runtime.runner-readiness.v2';
}

export function runnerReadinessRepositoryIdForDevelopment(
  repository: DevelopmentRepositoryDefinition,
): RunnerReadinessV2RepositoryId | null {
  return DEVELOPMENT_TO_RUNNER_REPOSITORY_ID[repository.id] ?? null;
}

export function developmentRepositoryIdForRunnerEvidence(
  repositoryId: RunnerReadinessV2RepositoryId,
): string {
  return RUNNER_TO_DEVELOPMENT_REPOSITORY_ID[repositoryId];
}

export function selectRunnerRepositoryEvidence(
  record: RuntimeRunnerReadinessRecordV2,
  repository: DevelopmentRepositoryDefinition,
): RuntimeRunnerRepositoryEvidenceV2 | null {
  const runnerRepositoryId = runnerReadinessRepositoryIdForDevelopment(repository);
  if (!runnerRepositoryId) return null;
  const evidence = record.repositories.find((item) => item.repositoryId === runnerRepositoryId);
  if (!evidence) return null;
  if (evidence.fullName !== repository.fullName) return null;
  return evidence;
}

export type RunnerRepositoryReconciliation = {
  checkoutReasonCode: string;
  checkoutState: RuntimeRunnerCapabilityState;
  checkoutBlocking: boolean;
  executorReasonCode: string;
  executorState: RuntimeRunnerCapabilityState;
  executorBlocking: boolean;
  evidence: {
    schemaVersion: RuntimeRunnerReadinessRecord['schemaVersion'];
    identity: string;
    checkedAt: string;
    expiresAt: string;
    repositoryId: string;
    canonicalRepository: string;
    observedBaselineSha: string | null;
    verifiedBaselineSha: string | null;
    readinessState: 'ready' | 'blocked' | 'degraded';
    blockingReason: string | null;
    evidenceAgeMs: number;
  };
};

function blockedReconciliation(
  record: RuntimeRunnerReadinessRecord,
  repository: DevelopmentRepositoryDefinition,
  checkoutReasonCode: string,
  executorReasonCode: string,
  blockingReason: string,
  baselineSha: string | null,
  observedBaselineSha: string | null,
  nowMs: number,
): RunnerRepositoryReconciliation {
  const executorReason = executorReasonCode || 'runtime_executor_probe_failed';
  return {
    checkoutReasonCode,
    checkoutState: 'blocked',
    checkoutBlocking: true,
    executorReasonCode: executorReason,
    executorState: 'blocked',
    executorBlocking: true,
    evidence: {
      schemaVersion: record.schemaVersion,
      identity: record.runnerId,
      checkedAt: record.checkedAt,
      expiresAt: record.expiresAt,
      repositoryId: repository.id,
      canonicalRepository: repository.fullName,
      observedBaselineSha,
      verifiedBaselineSha: baselineSha,
      readinessState: 'blocked',
      blockingReason,
      evidenceAgeMs: Math.max(0, nowMs - Date.parse(record.checkedAt)),
    },
  };
}

export function reconcileRunnerReadinessForRepository(input: {
  record: RuntimeRunnerReadinessRecord;
  repository: DevelopmentRepositoryDefinition;
  baselineSha: string | null;
  nowMs: number;
}): RunnerRepositoryReconciliation {
  const { record, repository, baselineSha, nowMs } = input;

  if (isRuntimeRunnerReadinessV2(record)) {
    return reconcileRunnerReadinessV2({ record, repository, baselineSha, nowMs });
  }

  if (!isRuntimeRunnerReadinessV1(record)) {
    return blockedReconciliation(
      record,
      repository,
      'runtime_runner_readiness_unsupported_version',
      'runtime_runner_readiness_unsupported_version',
      'Версия подтверждения готовности Runtime Runner не поддерживается.',
      baselineSha,
      null,
      nowMs,
    );
  }

  return reconcileRunnerReadinessV1({ record, repository, baselineSha, nowMs });
}

function reconcileRunnerReadinessV1(input: {
  record: RuntimeRunnerReadinessRecordV1;
  repository: DevelopmentRepositoryDefinition;
  baselineSha: string | null;
  nowMs: number;
}): RunnerRepositoryReconciliation {
  const { record, repository, baselineSha, nowMs } = input;
  const reportedExecutor = record.capabilities.executor;
  const executorReason = reportedExecutor.reasonCode;
  const executorBlocking = reportedExecutor.state !== 'ready';
  const reportedCheckouts = record.capabilities.checkouts;
  const checkoutReason = reportedCheckouts.reasonCode;

  const baseEvidence = {
    schemaVersion: record.schemaVersion,
    identity: record.runnerId,
    checkedAt: record.checkedAt,
    expiresAt: record.expiresAt,
    repositoryId: repository.id,
    canonicalRepository: repository.fullName,
    observedBaselineSha: record.baselineSha,
    verifiedBaselineSha: baselineSha,
    evidenceAgeMs: Math.max(0, nowMs - Date.parse(record.checkedAt)),
  };

  if (reportedCheckouts.state === 'blocked') {
    return {
      checkoutReasonCode: checkoutReason,
      checkoutState: 'blocked',
      checkoutBlocking: true,
      executorReasonCode: executorReason,
      executorState: reportedExecutor.state,
      executorBlocking,
      evidence: {
        ...baseEvidence,
        readinessState: 'blocked',
        blockingReason: 'Рабочие каталоги Runtime заблокированы.',
      },
    };
  }

  if (!baselineSha) {
    return {
      checkoutReasonCode: 'runtime_checkout_baseline_unavailable',
      checkoutState: 'blocked',
      checkoutBlocking: true,
      executorReasonCode: executorReason,
      executorState: reportedExecutor.state,
      executorBlocking,
      evidence: {
        ...baseEvidence,
        readinessState: 'blocked',
        blockingReason: 'Не удалось проверить main для выбранного репозитория.',
      },
    };
  }

  const compareLandingBaseline = repository.id === 'asi-landing';
  if (compareLandingBaseline && record.baselineSha !== baselineSha) {
    return {
      checkoutReasonCode: 'runtime_baseline_remote_mismatch',
      checkoutState: 'blocked',
      checkoutBlocking: true,
      executorReasonCode: executorReason,
      executorState: reportedExecutor.state,
      executorBlocking,
      evidence: {
        ...baseEvidence,
        readinessState: 'blocked',
        blockingReason: 'Версия main не совпала с удалённым репозиторием.',
      },
    };
  }

  if (record.capabilities.baselineRecovery.state !== 'ready') {
    return {
      checkoutReasonCode: 'runtime_baseline_recovery_unavailable',
      checkoutState: 'blocked',
      checkoutBlocking: true,
      executorReasonCode: executorReason,
      executorState: reportedExecutor.state,
      executorBlocking,
      evidence: {
        ...baseEvidence,
        readinessState: 'blocked',
        blockingReason: 'Runtime Runner не подтвердил безопасное восстановление рабочей версии.',
      },
    };
  }

  const checkoutBlocking = false;
  return {
    checkoutReasonCode: checkoutReason,
    checkoutState: reportedCheckouts.state,
    checkoutBlocking,
    executorReasonCode: executorReason,
    executorState: reportedExecutor.state,
    executorBlocking,
    evidence: {
      ...baseEvidence,
      readinessState: executorBlocking ? 'blocked' : reportedCheckouts.state,
      blockingReason: executorBlocking ? 'Исполнитель задач недоступен.' : null,
    },
  };
}

function reconcileRunnerReadinessV2(input: {
  record: RuntimeRunnerReadinessRecordV2;
  repository: DevelopmentRepositoryDefinition;
  baselineSha: string | null;
  nowMs: number;
}): RunnerRepositoryReconciliation {
  const { record, repository, baselineSha, nowMs } = input;
  const reportedExecutor = record.capabilities.executor;
  const reportedCheckouts = record.capabilities.checkouts;
  const reportedBaselineRecovery = record.capabilities.baselineRecovery;
  const executorReason = reportedExecutor.reasonCode;
  const checkoutReason = reportedCheckouts.reasonCode;
  const executorBlocking = reportedExecutor.state !== 'ready'
    || record.blockers.length > 0;

  const repositoryEvidence = selectRunnerRepositoryEvidence(record, repository);
  if (!repositoryEvidence) {
    return blockedReconciliation(
      record,
      repository,
      'runtime_runner_repository_evidence_missing',
      executorBlocking ? executorReason : 'runtime_runner_repository_evidence_missing',
      'Runtime Runner не опубликовал подтверждение для выбранного репозитория.',
      baselineSha,
      null,
      nowMs,
    );
  }

  const baseEvidence = {
    schemaVersion: record.schemaVersion,
    identity: record.runnerId,
    checkedAt: record.checkedAt,
    expiresAt: record.expiresAt,
    repositoryId: repository.id,
    canonicalRepository: repository.fullName,
    observedBaselineSha: repositoryEvidence.observedBaselineSha,
    verifiedBaselineSha: baselineSha,
    evidenceAgeMs: Math.max(0, nowMs - Date.parse(record.checkedAt)),
  };

  if (reportedCheckouts.state === 'blocked') {
    return {
      checkoutReasonCode: checkoutReason,
      checkoutState: 'blocked',
      checkoutBlocking: true,
      executorReasonCode: executorReason,
      executorState: reportedExecutor.state,
      executorBlocking,
      evidence: {
        ...baseEvidence,
        readinessState: 'blocked',
        blockingReason: 'Рабочие каталоги Runtime заблокированы.',
      },
    };
  }

  if (reportedBaselineRecovery.state !== 'ready') {
    return {
      checkoutReasonCode: 'runtime_baseline_recovery_unavailable',
      checkoutState: 'blocked',
      checkoutBlocking: true,
      executorReasonCode: executorReason,
      executorState: reportedExecutor.state,
      executorBlocking,
      evidence: {
        ...baseEvidence,
        readinessState: 'blocked',
        blockingReason: 'Runtime Runner не подтвердил безопасное восстановление рабочей версии.',
      },
    };
  }

  if (!repositoryEvidence.originReady) {
    return {
      checkoutReasonCode: 'runtime_checkout_remote_mismatch',
      checkoutState: 'blocked',
      checkoutBlocking: true,
      executorReasonCode: executorReason,
      executorState: reportedExecutor.state,
      executorBlocking,
      evidence: {
        ...baseEvidence,
        readinessState: 'blocked',
        blockingReason: 'Источник Git не совпадает с разрешённым репозиторием.',
      },
    };
  }

  if (!repositoryEvidence.checkoutReady) {
    const checkoutReason = repositoryEvidence.blockers[0] ?? 'runtime_checkout_probe_failed';
    return {
      checkoutReasonCode: checkoutReason,
      checkoutState: 'blocked',
      checkoutBlocking: true,
      executorReasonCode: executorReason,
      executorState: reportedExecutor.state,
      executorBlocking,
      evidence: {
        ...baseEvidence,
        readinessState: 'blocked',
        blockingReason: 'Рабочий каталог выбранного репозитория не готов.',
      },
    };
  }

  if (!baselineSha) {
    return {
      checkoutReasonCode: 'runtime_checkout_baseline_unavailable',
      checkoutState: 'blocked',
      checkoutBlocking: true,
      executorReasonCode: executorReason,
      executorState: reportedExecutor.state,
      executorBlocking,
      evidence: {
        ...baseEvidence,
        readinessState: 'blocked',
        blockingReason: 'Не удалось проверить main для выбранного репозитория.',
      },
    };
  }

  if (!repositoryEvidence.baselineReady
    || repositoryEvidence.observedBaselineSha !== baselineSha) {
    return {
      checkoutReasonCode: 'runtime_baseline_remote_mismatch',
      checkoutState: 'blocked',
      checkoutBlocking: true,
      executorReasonCode: executorReason,
      executorState: reportedExecutor.state,
      executorBlocking,
      evidence: {
        ...baseEvidence,
        readinessState: 'blocked',
        blockingReason: 'Версия main не совпала с подтверждением Runtime Runner.',
      },
    };
  }

  if (!repositoryEvidence.recoveryReady) {
    return {
      checkoutReasonCode: 'runtime_baseline_recovery_unavailable',
      checkoutState: 'blocked',
      checkoutBlocking: true,
      executorReasonCode: executorReason,
      executorState: reportedExecutor.state,
      executorBlocking,
      evidence: {
        ...baseEvidence,
        readinessState: 'blocked',
        blockingReason: 'Runtime Runner не подтвердил безопасное восстановление рабочей версии.',
      },
    };
  }

  if (executorBlocking) {
    return {
      checkoutReasonCode: 'runtime_checkouts_ready',
      checkoutState: 'ready',
      checkoutBlocking: false,
      executorReasonCode: executorReason,
      executorState: reportedExecutor.state,
      executorBlocking: true,
      evidence: {
        ...baseEvidence,
        readinessState: 'blocked',
        blockingReason: record.blockers.length > 0
          ? 'Runtime Runner сообщил общий блокер.'
          : 'Исполнитель задач недоступен.',
      },
    };
  }

  return {
    checkoutReasonCode: 'runtime_checkouts_ready',
    checkoutState: 'ready',
    checkoutBlocking: false,
    executorReasonCode: executorReason,
    executorState: reportedExecutor.state,
    executorBlocking: false,
    evidence: {
      ...baseEvidence,
      readinessState: 'ready',
      blockingReason: null,
    },
  };
}

export function expectedFullNameForRunnerRepositoryId(
  repositoryId: RunnerReadinessV2RepositoryId,
): (typeof DEVELOPMENT_REPOSITORY_ALLOWLIST)[number]['fullName'] | null {
  const developmentId = developmentRepositoryIdForRunnerEvidence(repositoryId);
  const repo = DEVELOPMENT_REPOSITORY_ALLOWLIST.find((item) => item.id === developmentId);
  return repo?.fullName ?? null;
}

export function isAllowedRunnerRepositoryFullName(fullName: string): boolean {
  return ALLOWED_FULL_NAMES.has(fullName as (typeof DEVELOPMENT_REPOSITORY_ALLOWLIST)[number]['fullName']);
}
