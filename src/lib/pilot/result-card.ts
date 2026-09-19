/**
 * SP-07 — user-facing result card model (Russian copy + action guidance).
 * Consumes the sanitized SP-04 result view; does not re-read raw Bridge payloads.
 */
import type { PilotHitlView } from './hitl';
import type { PilotConsoleStatus } from './status';
import type { PilotSafeResultView } from './result-view';
import { PILOT_USER_STATE } from './user-copy';

export const PILOT_RESULT_FALLBACK_SUCCEEDED =
  'Задача завершена. Если нужны дополнительные детали — обратитесь к владельцу ASI.' as const;

export const PILOT_RESULT_FALLBACK_FAILED =
  'Задача завершилась с ошибкой. Безопасные детали недоступны — обратитесь к владельцу ASI.' as const;

export const PILOT_OUTCOME_LABELS = {
  succeeded: PILOT_USER_STATE.done,
  failed: PILOT_USER_STATE.failed,
} as const;

export type PilotResultCardKind = 'pending' | 'succeeded' | 'blocked' | 'failed';

export type PilotResultCardModel = {
  kind: PilotResultCardKind;
  headlineRu: string;
  summaryRu: string | null;
  outcomeLabelRu: string | null;
  nextActionRu: string;
  userActionRequired: boolean;
  changedFiles: string[];
  pullRequestUrl: string | null;
  commitSha: string | null;
  blockers: string[];
};

function emptyArtifacts(): Pick<
  PilotResultCardModel,
  'changedFiles' | 'pullRequestUrl' | 'commitSha' | 'blockers'
> {
  return {
    changedFiles: [],
    pullRequestUrl: null,
    commitSha: null,
    blockers: [],
  };
}

/**
 * Map console status + sanitized result into a stable Pilot result card.
 */
export function buildPilotResultCardModel(input: {
  consoleStatus: PilotConsoleStatus;
  result: PilotSafeResultView | null | undefined;
  hitl?: PilotHitlView | null;
}): PilotResultCardModel {
  const result = input.result ?? null;
  const hitl = input.hitl ?? null;
  const artifacts = {
    changedFiles: result?.changedFiles ?? [],
    pullRequestUrl: result?.pullRequestUrl ?? null,
    commitSha: result?.commitSha ?? null,
    blockers: result?.blockers ?? [],
  };

  switch (input.consoleStatus) {
    case 'succeeded': {
      const summaryRu = result?.summary?.trim()
        || PILOT_RESULT_FALLBACK_SUCCEEDED;
      return {
        kind: 'succeeded',
        headlineRu: PILOT_USER_STATE.done,
        summaryRu,
        outcomeLabelRu: PILOT_OUTCOME_LABELS.succeeded,
        nextActionRu: 'Действий с вашей стороны не требуется.',
        userActionRequired: false,
        ...artifacts,
      };
    }
    case 'blocked': {
      const question = hitl?.questionRu?.trim() || null;
      const canContinue = hitl?.canContinue === true;
      return {
        kind: 'blocked',
        headlineRu: PILOT_USER_STATE.needsAnswer,
        summaryRu: question || result?.summary?.trim() || null,
        outcomeLabelRu: null,
        nextActionRu: canContinue
          ? 'Ответьте на вопрос ниже, чтобы продолжить эту же задачу.'
          : 'Нужен ваш ответ. После ответа задача продолжится автоматически.',
        userActionRequired: canContinue,
        ...artifacts,
        blockers: artifacts.blockers,
      };
    }
    case 'failed': {
      const summaryRu = result?.summary?.trim()
        || (artifacts.blockers[0] ?? PILOT_RESULT_FALLBACK_FAILED);
      return {
        kind: 'failed',
        headlineRu: PILOT_USER_STATE.failed,
        summaryRu,
        outcomeLabelRu: PILOT_OUTCOME_LABELS.failed,
        nextActionRu:
          'Действий с вашей стороны не требуется, кроме ожидания помощи владельца ASI при необходимости.',
        userActionRequired: false,
        ...artifacts,
      };
    }
    case 'queued':
    case 'running':
    default:
      return {
        kind: 'pending',
        headlineRu: input.consoleStatus === 'running'
          ? PILOT_USER_STATE.inProgress
          : PILOT_USER_STATE.readyToWork,
        summaryRu: null,
        outcomeLabelRu: null,
        nextActionRu: 'Результат появится автоматически. Пока ничего делать не нужно.',
        userActionRequired: false,
        ...emptyArtifacts(),
      };
  }
}
