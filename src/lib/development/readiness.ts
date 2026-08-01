import 'server-only';
import { parseRuntimeBridgeClientId } from '@/lib/asi-runtime/bridge-auth';
import { probeRuntimeBridgeStorage } from '@/lib/asi-runtime/bridge-repository';
import { readRuntimeBridgeSupabaseConfig } from '@/lib/asi-runtime/bridge-supabase';
import {
  inspectRuntimeCheckoutReadiness,
  parseRuntimeCheckoutConfig,
} from '../../../scripts/asi-runtime-baseline-recovery.mjs';
import { inspectRuntimeRunnerPrerequisites } from '../../../scripts/asi-runtime-runner-config.mjs';
import { resolveAllowlistedBaselineSha } from './baseline-sha';
import { probeGitHubMergeProvider } from './github-control-center';
import { DEVELOPMENT_REPOSITORY_ALLOWLIST } from './repositories';
import type {
  DevelopmentReadinessComponent,
  DevelopmentReadinessSnapshot,
  DevelopmentReadinessState,
} from './readiness-types';

type Checkout = { id: string; path: string };
type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

type ReadinessDependencies = {
  env?: RuntimeEnvironment;
  now?: () => Date;
  probeBridgeStorage?: () => Promise<void>;
  resolveBaselineSha?: () => Promise<string>;
  parseCheckouts?: (raw: string | undefined) => Checkout[];
  inspectCheckouts?: (input: {
    checkouts: Checkout[];
    repository: 'ASI-integration/asi-landing';
    branch: 'main';
    baselineSha: string;
  }) => Promise<{ state: 'ready' | 'degraded'; reasonCode: string }>;
  inspectExecutor?: (env: RuntimeEnvironment) => Promise<{ ready: boolean; reasonCode: string }>;
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
  baseline_ready: 'Текущая версия main определена.',
  baseline_unavailable: 'Не удалось получить текущую версию main.',
  runtime_executor_ready: 'Исполнитель задач готов.',
  runtime_runner_url_missing: 'Адрес Runtime Runner не настроен.',
  runtime_runner_url_invalid: 'Адрес Runtime Runner указан некорректно.',
  runtime_runner_credentials_invalid: 'Доступ Runtime Runner не настроен или настроен некорректно.',
  runtime_executor_missing: 'Исполнитель задач не настроен.',
  runtime_executor_invalid: 'Настройки исполнителя задач некорректны.',
  runtime_executor_unavailable: 'Исполнитель задач недоступен на сервере.',
  runtime_executor_probe_failed: 'Не удалось проверить исполнитель задач.',
  github_provider_ready: 'GitHub подключён и доступен для разрешённого репозитория.',
  github_provider_missing: 'Подключение к GitHub не настроено.',
  github_provider_unauthenticated: 'GitHub не подтвердил доступ сервера.',
  github_provider_repository_mismatch: 'GitHub подключён не к разрешённому репозиторию.',
  github_provider_unreachable: 'GitHub сейчас недоступен для проверки.',
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
]);

const EXECUTOR_REASON_CODES = new Set([
  'runtime_executor_ready',
  'runtime_runner_url_missing',
  'runtime_runner_url_invalid',
  'runtime_runner_credentials_invalid',
  'runtime_executor_missing',
  'runtime_executor_invalid',
  'runtime_executor_unavailable',
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

async function checkoutReadiness(input: {
  env: RuntimeEnvironment;
  baselineSha: string | null;
  parse: NonNullable<ReadinessDependencies['parseCheckouts']>;
  inspect: NonNullable<ReadinessDependencies['inspectCheckouts']>;
}): Promise<DevelopmentReadinessComponent> {
  const raw = input.env.ASI_RUNTIME_BRIDGE_CHECKOUTS_JSON;
  if (!String(raw ?? '').trim()) {
    return component('blocked', 'runtime_checkout_config_missing', true);
  }
  let checkouts: Checkout[];
  try {
    checkouts = input.parse(raw);
  } catch {
    return component('blocked', 'runtime_checkout_config_invalid', true);
  }
  if (!input.baselineSha) {
    return component('blocked', 'runtime_checkout_baseline_unavailable', true);
  }
  try {
    const result = await input.inspect({
      checkouts,
      repository: 'ASI-integration/asi-landing',
      branch: 'main',
      baselineSha: input.baselineSha,
    });
    const reasonCode = CHECKOUT_REASON_CODES.has(result.reasonCode)
      ? result.reasonCode
      : result.state === 'degraded'
        ? 'runtime_checkout_recoverable_drift'
        : 'runtime_checkouts_ready';
    return component(result.state, reasonCode, false);
  } catch (error) {
    return component(
      'blocked',
      safeCode(error, CHECKOUT_REASON_CODES, 'runtime_checkout_probe_failed'),
      true,
    );
  }
}

async function executorReadiness(
  env: RuntimeEnvironment,
  inspect: NonNullable<ReadinessDependencies['inspectExecutor']>,
): Promise<DevelopmentReadinessComponent> {
  try {
    const result = await inspect(env);
    const reasonCode = EXECUTOR_REASON_CODES.has(result.reasonCode)
      ? result.reasonCode
      : 'runtime_executor_probe_failed';
    return component(result.ready ? 'ready' : 'blocked', reasonCode, !result.ready);
  } catch {
    return component('blocked', 'runtime_executor_probe_failed', true);
  }
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
  const repository = DEVELOPMENT_REPOSITORY_ALLOWLIST[0];
  const [bridge, baseline, executor, github] = await Promise.all([
    bridgeReadiness(env, dependencies.probeBridgeStorage ?? (() => probeRuntimeBridgeStorage())),
    baselineReadiness(dependencies.resolveBaselineSha ?? (() => resolveAllowlistedBaselineSha(repository))),
    executorReadiness(env, dependencies.inspectExecutor ?? inspectRuntimeRunnerPrerequisites),
    githubReadiness(dependencies.probeGitHub ?? (() => probeGitHubMergeProvider())),
  ]);
  const checkouts = await checkoutReadiness({
    env,
    baselineSha: baseline.sha,
    parse: dependencies.parseCheckouts ?? parseRuntimeCheckoutConfig,
    inspect: dependencies.inspectCheckouts ?? (async (input) => {
      const result = await inspectRuntimeCheckoutReadiness(input);
      return {
        state: result.state === 'degraded' ? 'degraded' as const : 'ready' as const,
        reasonCode: String(result.reasonCode),
      };
    }),
  });
  const components = { bridge, checkouts, baseline: baseline.component, executor, github };
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
    checkedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    components,
  };
}
