import 'server-only';
import { parseRuntimeBridgeClientId } from '@/lib/asi-runtime/bridge-auth';
import {
  getPublishedRuntimeRunnerReadiness,
  probeRuntimeBridgeStorage,
} from '@/lib/asi-runtime/bridge-repository';
import { readRuntimeBridgeSupabaseConfig } from '@/lib/asi-runtime/bridge-supabase';
import type { RuntimeRunnerReadinessStatus } from '@/lib/asi-runtime/bridge-runner-readiness';
import { resolveAllowlistedBaselineSha } from './baseline-sha';
import { probeGitHubMergeProvider } from './github-control-center';
import {
  DEVELOPMENT_REPOSITORY_ALLOWLIST,
  resolveDevelopmentRepository,
  type DevelopmentRepositoryDefinition,
} from './repositories';
import type {
  DevelopmentReadinessComponent,
  DevelopmentReadinessSnapshot,
  DevelopmentReadinessState,
} from './readiness-types';

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

type ReadinessDependencies = {
  repositoryId?: string | null;
  env?: RuntimeEnvironment;
  now?: () => Date;
  probeBridgeStorage?: () => Promise<void>;
  resolveBaselineSha?: () => Promise<string>;
  loadRunnerReadiness?: (clientId: string, now: number) => Promise<RuntimeRunnerReadinessStatus>;
  probeGitHub?: () => Promise<void>;
};

const MESSAGES: Record<string, string> = {
  bridge_ready: 'Связь с Runtime Bridge готова.',
  bridge_config_missing: 'Подключение к Runtime Bridge не настроено.',
  bridge_config_invalid: 'Настройки Runtime Bridge заполнены некорректно.',
  bridge_storage_unreachable: 'Хранилище Runtime Bridge сейчас недоступно.',
  runtime_checkouts_ready: 'Оба рабочих каталога Runtime готовы.',
  runtime_checkout_config_missing: 'Рабочие каталоги Runtime не настроены.',
  runtime_checkout_config_invalid: 'Настройки рабочих каталогов Runtime некорректны.',
  runtime_checkout_missing: 'Один из рабочих каталогов Runtime не найден.',
  runtime_checkout_not_git: 'Один из рабочих каталогов Runtime не является Git-репозиторием.',
  runtime_checkout_dirty: 'В одном из рабочих каталогов Runtime есть несохранённые изменения.',
  runtime_checkout_remote_missing: 'В одном из рабочих каталогов Runtime не настроен источник.',
  runtime_checkout_remote_mismatch: 'Один из рабочих каталогов Runtime связан с другим репозиторием.',
  runtime_checkout_recoverable_drift: 'Рабочие каталоги чистые и будут обновлены перед запуском.',
  runtime_baseline_remote_unavailable: 'Не удалось проверить main для одного из рабочих каталогов.',
  runtime_baseline_remote_mismatch: 'Версия main не совпала с удалённым репозиторием.',
  runtime_checkout_probe_failed: 'Не удалось безопасно проверить рабочие каталоги Runtime.',
  runtime_checkout_baseline_unavailable: 'Рабочие каталоги нельзя проверить без актуальной версии main.',
  runtime_runner_readiness_missing: 'Runtime Runner ещё не подтвердил готовность.',
  runtime_runner_readiness_stale: 'Подтверждение готовности Runtime Runner устарело.',
  runtime_baseline_recovery_ready: 'Восстановление рабочей версии Runtime готово.',
  runtime_baseline_recovery_unavailable: 'Runtime Runner не подтвердил безопасное восстановление рабочей версии.',
  baseline_ready: 'Текущая версия main определена.',
  baseline_unavailable: 'Не удалось получить текущую версию main.',
  runtime_executor_ready: 'Исполнитель задач готов.',
  runtime_runner_url_missing: 'Адрес Runtime Runner не настроен.',
  runtime_runner_url_invalid: 'Адрес Runtime Runner указан некорректно.',
  runtime_runner_credentials_invalid: 'Доступ Runtime Runner не настроен или настроен некорректно.',
  runtime_executor_missing: 'Исполнитель задач не настроен.',
  runtime_executor_invalid: 'Настройки исполнителя задач некорректны.',
  runtime_executor_unavailable: 'Исполнитель задач недоступен на сервере.',
  runtime_executor_entrypoint_missing: 'Не указан файл запуска исполнителя задач.',
  runtime_executor_entrypoint_unavailable: 'Файл запуска исполнителя задач недоступен.',
  runtime_executor_probe_failed: 'Не удалось проверить исполнитель задач.',
  github_provider_ready: 'GitHub подключён и доступен для разрешённого репозитория.',
  github_provider_missing: 'Подключение к GitHub не настроено.',
  github_provider_unauthenticated: 'GitHub не подтвердил доступ сервера.',
  github_provider_repository_mismatch: 'GitHub подключён не к разрешённому репозиторию.',
  github_provider_unreachable: 'GitHub сейчас недоступен для проверки.',
  repository_not_allowed: 'Репозиторий не разрешён для консоли разработки.',
};

const CHECKOUT_REASON_CODES = new Set([
  'runtime_checkout_missing',
  'runtime_checkout_not_git',
  'runtime_checkout_dirty',
  'runtime_checkout_remote_missing',
  'runtime_checkout_remote_mismatch',
  'runtime_checkout_recoverable_drift',
  'runtime_checkouts_ready',
  'runtime_baseline_remote_unavailable',
  'runtime_baseline_remote_mismatch',
  'runtime_checkout_config_missing',
  'runtime_checkout_config_invalid',
  'runtime_checkout_probe_failed',
  'runtime_checkout_baseline_unavailable',
  'runtime_runner_readiness_missing',
  'runtime_runner_readiness_stale',
  'runtime_baseline_recovery_unavailable',
]);

const EXECUTOR_REASON_CODES = new Set([
  'runtime_executor_ready',
  'runtime_runner_url_missing',
  'runtime_runner_url_invalid',
  'runtime_runner_credentials_invalid',
  'runtime_executor_missing',
  'runtime_executor_invalid',
  'runtime_executor_unavailable',
  'runtime_executor_entrypoint_missing',
  'runtime_executor_entrypoint_unavailable',
  'runtime_executor_probe_failed',
  'runtime_runner_readiness_missing',
  'runtime_runner_readiness_stale',
]);

const GITHUB_REASON_CODES = new Set([
  'github_provider_missing',
  'github_provider_unauthenticated',
  'github_provider_repository_mismatch',
  'github_provider_unreachable',
]);

function component(
  state: DevelopmentReadinessState,
  reasonCode: string,
  blockingLaunch: boolean,
): DevelopmentReadinessComponent {
  return {
    state,
    reasonCode,
    message: MESSAGES[reasonCode] ?? 'Проверка завершилась с неизвестным состоянием.',
    blockingLaunch,
  };
}

function safeCode(error: unknown, allowed: Set<string>, fallback: string): string {
  const value = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  return allowed.has(value) ? value : fallback;
}

async function bridgeReadiness(
  env: RuntimeEnvironment,
  probe: () => Promise<void>,
): Promise<DevelopmentReadinessComponent> {
  const required = [
    env.ASI_RUNTIME_BRIDGE_CLIENT_ID,
    env.ASI_RUNTIME_BRIDGE_SUPABASE_URL,
    env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY,
  ];
  if (required.some((value) => !String(value ?? '').trim())) {
    return component('blocked', 'bridge_config_missing', true);
  }
  if (!parseRuntimeBridgeClientId(env.ASI_RUNTIME_BRIDGE_CLIENT_ID)
    || !readRuntimeBridgeSupabaseConfig(env).ok) {
    return component('blocked', 'bridge_config_invalid', true);
  }
  try {
    await probe();
    return component('ready', 'bridge_ready', false);
  } catch {
    return component('blocked', 'bridge_storage_unreachable', true);
  }
}

async function baselineReadiness(
  resolve: () => Promise<string>,
): Promise<{ component: DevelopmentReadinessComponent; sha: string | null }> {
  try {
    return {
      component: component('ready', 'baseline_ready', false),
      sha: await resolve(),
    };
  } catch {
    return { component: component('blocked', 'baseline_unavailable', true), sha: null };
  }
}

function blockedRepositorySnapshot(checkedAt: Date): DevelopmentReadinessSnapshot {
  const blocked = component('blocked', 'repository_not_allowed', true);
  return {
    schemaVersion: 'asi.owner-console.readiness.v1',
    overallState: 'blocked',
    canLaunch: false,
    checkedAt: checkedAt.toISOString(),
    runnerEvidence: null,
    components: {
      bridge: blocked,
      checkouts: blocked,
      baseline: blocked,
      executor: blocked,
      github: blocked,
    },
  };
}

/**
 * runner-readiness.v1 publishes baselineSha for ASI-integration/asi-landing only.
 * Do not compare server-resolved asi-os-runtime/main against that landing-only field.
 * Follow-up: runner-readiness v2 will publish per-repository baseline evidence.
 */
function shouldCompareRunnerV1BaselineSha(repository: DevelopmentRepositoryDefinition): boolean {
  return repository.id === 'asi-landing';
}

function runnerComponents(
  runner: RuntimeRunnerReadinessStatus,
  baselineSha: string | null,
  repository: DevelopmentRepositoryDefinition,
): {
  checkouts: DevelopmentReadinessComponent;
  executor: DevelopmentReadinessComponent;
  evidence: DevelopmentReadinessSnapshot['runnerEvidence'];
} {
  if (runner.status === 'missing') {
    return {
      checkouts: component('blocked', 'runtime_runner_readiness_missing', true),
      executor: component('blocked', 'runtime_runner_readiness_missing', true),
      evidence: null,
    };
  }
  const evidence = {
    identity: runner.record.runnerId,
    checkedAt: runner.record.checkedAt,
    expiresAt: runner.record.expiresAt,
  };
  if (runner.status === 'stale') {
    return {
      checkouts: component('blocked', 'runtime_runner_readiness_stale', true),
      executor: component('blocked', 'runtime_runner_readiness_stale', true),
      evidence,
    };
  }

  const reportedExecutor = runner.record.capabilities.executor;
  const executorReason = EXECUTOR_REASON_CODES.has(reportedExecutor.reasonCode)
    ? reportedExecutor.reasonCode
    : 'runtime_executor_probe_failed';
  const executor = component(
    reportedExecutor.state === 'ready' ? 'ready' : 'blocked',
    executorReason,
    reportedExecutor.state !== 'ready',
  );
  const reportedCheckouts = runner.record.capabilities.checkouts;
  const checkoutReason = CHECKOUT_REASON_CODES.has(reportedCheckouts.reasonCode)
    ? reportedCheckouts.reasonCode
    : 'runtime_checkout_probe_failed';
  if (reportedCheckouts.state === 'blocked') {
    return {
      checkouts: component('blocked', checkoutReason, true),
      executor,
      evidence,
    };
  }

  if (!baselineSha) {
    return {
      checkouts: component('blocked', 'runtime_checkout_baseline_unavailable', true),
      executor,
      evidence,
    };
  }
  if (
    shouldCompareRunnerV1BaselineSha(repository)
    && runner.record.baselineSha !== baselineSha
  ) {
    return {
      checkouts: component('blocked', 'runtime_baseline_remote_mismatch', true),
      executor,
      evidence,
    };
  }
  if (runner.record.capabilities.baselineRecovery.state !== 'ready') {
    return {
      checkouts: component('blocked', 'runtime_baseline_recovery_unavailable', true),
      executor,
      evidence,
    };
  }
  return {
    checkouts: component(
      reportedCheckouts.state,
      checkoutReason,
      false,
    ),
    executor,
    evidence,
  };
}

async function githubReadiness(probe: () => Promise<void>): Promise<DevelopmentReadinessComponent> {
  try {
    await probe();
    return component('ready', 'github_provider_ready', false);
  } catch (error) {
    return component(
      'blocked',
      safeCode(error, GITHUB_REASON_CODES, 'github_provider_unreachable'),
      false,
    );
  }
}

export async function getDevelopmentReadiness(
  dependencies: ReadinessDependencies = {},
): Promise<DevelopmentReadinessSnapshot> {
  const env = dependencies.env ?? process.env;
  const checkedAt = (dependencies.now ?? (() => new Date()))();
  const requestedRepositoryId = dependencies.repositoryId;
  const hasExplicitRepositoryId = String(requestedRepositoryId ?? '').trim().length > 0;
  const repository = hasExplicitRepositoryId
    ? resolveDevelopmentRepository(requestedRepositoryId)
    : DEVELOPMENT_REPOSITORY_ALLOWLIST[0];
  if (hasExplicitRepositoryId && !repository) {
    return blockedRepositorySnapshot(checkedAt);
  }
  if (!repository) {
    return blockedRepositorySnapshot(checkedAt);
  }

  const clientId = parseRuntimeBridgeClientId(env.ASI_RUNTIME_BRIDGE_CLIENT_ID);
  const loadRunner = dependencies.loadRunnerReadiness
    ?? (async (id: string, now: number) => getPublishedRuntimeRunnerReadiness(id, now));
  const [bridge, baseline, github, runner] = await Promise.all([
    bridgeReadiness(env, dependencies.probeBridgeStorage ?? (() => probeRuntimeBridgeStorage())),
    baselineReadiness(dependencies.resolveBaselineSha ?? (() => resolveAllowlistedBaselineSha(repository))),
    githubReadiness(dependencies.probeGitHub ?? (() => probeGitHubMergeProvider(repository))),
    clientId
      ? loadRunner(clientId, checkedAt.getTime()).catch(() => ({ status: 'missing' as const, record: null }))
      : Promise.resolve({ status: 'missing' as const, record: null }),
  ]);
  const runnerResult = runnerComponents(runner, baseline.sha, repository);
  const components = {
    bridge,
    checkouts: runnerResult.checkouts,
    baseline: baseline.component,
    executor: runnerResult.executor,
    github,
  };
  const states = Object.values(components).map((item) => item.state);
  const overallState: DevelopmentReadinessState = states.includes('blocked')
    ? 'blocked'
    : states.includes('degraded')
      ? 'degraded'
      : 'ready';

  return {
    schemaVersion: 'asi.owner-console.readiness.v1',
    overallState,
    canLaunch: !Object.values(components).some((item) => item.blockingLaunch),
    checkedAt: checkedAt.toISOString(),
    runnerEvidence: runnerResult.evidence,
    components,
  };
}
