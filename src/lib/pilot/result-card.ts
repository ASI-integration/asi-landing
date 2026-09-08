/**
 * SP-07 — user-facing result card model (Russian copy + action guidance).
 * Consumes the sanitized SP-04 result view; does not re-read raw Bridge payloads.
 */
import type { PilotConsoleStatus } from './status';
import type { PilotSafeResultView } from './result-view';

export const PILOT_RESULT_FALLBACK_SUCCEEDED =
  'Задача завершена. Если нужны дополнительные детали — обратитесь к владельцу ASI.' as const;

export const PILOT_RESULT_FALLBACK_FAILED =
  'Задача завершилась с ошибкой. Безопасные детали недоступны — обратитесь к владельцу ASI.' as const;

export const PILOT_OUTCOME_LABELS = {
  succeeded: 'Успешно',
  failed: 'Ошибка',
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
}): PilotResultCardModel {
  const result = input.result ?? null;
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
        headlineRu: 'Готово',
        summaryRu,
        outcomeLabelRu: PILOT_OUTCOME_LABELS.succeeded,
        nextActionRu: 'Действий с вашей стороны не требуется.',
        userActionRequired: false,
        ...artifacts,
      };
    }
    case 'blocked': {
      return {
        kind: 'blocked',
        headlineRu: 'Нужно внимание владельца',
        summaryRu: result?.summary?.trim() || null,
        outcomeLabelRu: null,
        nextActionRu:
          'Вам ничего делать не нужно. Владелец ASI получит эскалацию в Telegram и разберёт задачу.',
        userActionRequired: false,
        ...artifacts,
        blockers: artifacts.blockers,
      };
    }
    case 'failed': {
      const summaryRu = result?.summary?.trim()
        || (artifacts.blockers[0] ?? PILOT_RESULT_FALLBACK_FAILED);
      return {
        kind: 'failed',
        headlineRu: 'Ошибка',
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
        headlineRu: input.consoleStatus === 'running' ? 'В работе' : 'В очереди',
        summaryRu: null,
        outcomeLabelRu: null,
        nextActionRu: 'Результат появится автоматически. Пока ничего делать не нужно.',
        userActionRequired: false,
        ...emptyArtifacts(),
      };
  }
}
