/**
 * SP-08 — Pilot readiness gate.
 * Reuses owner-console readiness (`asi.owner-console.readiness.v1` / canLaunch).
 * Exposes only a safe normalized pilot view — no components, paths, or secrets.
 */
import 'server-only';
import { getDevelopmentReadiness } from '@/lib/development/readiness';
import type { DevelopmentReadinessSnapshot } from '@/lib/development/readiness-types';
import { PilotAccessError } from './errors';

export type PilotReadinessState = 'ready' | 'not_ready' | 'error';

export type PilotReadinessView = {
  state: PilotReadinessState;
  canSubmit: boolean;
  messageRu: string;
  checkedAt: string;
};

const MSG_READY = 'Система готова к запуску задач пилота.';
const MSG_NOT_READY =
  'Сейчас нельзя создать новую задачу. Runtime ещё не готов — попробуйте позже.';
const MSG_ERROR = 'Не удалось проверить готовность. Попробуйте позже.';

export type PilotReadinessDependencies = {
  loadOwnerReadiness?: () => Promise<DevelopmentReadinessSnapshot>;
  now?: () => Date;
};

/**
 * Safe pilot-facing readiness derived from existing owner-console readiness.
 */
export async function getPilotReadiness(
  deps: PilotReadinessDependencies = {},
): Promise<PilotReadinessView> {
  const now = deps.now ?? (() => new Date());
  try {
    const snapshot = await (deps.loadOwnerReadiness ?? getDevelopmentReadiness)();
    if (snapshot.canLaunch === true) {
      return {
        state: 'ready',
        canSubmit: true,
        messageRu: MSG_READY,
        checkedAt: snapshot.checkedAt,
      };
    }
    return {
      state: 'not_ready',
      canSubmit: false,
      messageRu: MSG_NOT_READY,
      checkedAt: snapshot.checkedAt,
    };
  } catch {
    return {
      state: 'error',
      canSubmit: false,
      messageRu: MSG_ERROR,
      checkedAt: now().toISOString(),
    };
  }
}

/**
 * Fail closed before Bridge create when Runtime/Bridge path is not launchable.
 */
export async function assertPilotSubmissionReady(
  deps: PilotReadinessDependencies = {},
): Promise<PilotReadinessView> {
  const readiness = await getPilotReadiness(deps);
  if (readiness.state === 'error') {
    throw new PilotAccessError('readiness_unavailable', 503, readiness.messageRu);
  }
  if (!readiness.canSubmit) {
    throw new PilotAccessError('readiness_blocked', 503, readiness.messageRu);
  }
  return readiness;
}
