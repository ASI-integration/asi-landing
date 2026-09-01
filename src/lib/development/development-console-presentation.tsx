import type { ReactNode } from 'react';
import type { ControlCenterMergeGateView } from '@/lib/development/owner-merge-gate';
import type {
  DevelopmentReadinessComponent,
  DevelopmentReadinessComponentId,
  DevelopmentReadinessSnapshot,
  DevelopmentReadinessState,
} from '@/lib/development/readiness-types';
import {
  ItemReadinessBadge,
  ReadinessStateIcon,
  readinessStateColorClass,
} from '@/lib/development/readiness-status-ui';

export const OVERALL_STATUS_HEADLINE = {
  ready: 'ГОТОВО',
  degraded: 'ВНИМАНИЕ',
  blocked: 'СТОП',
} as const satisfies Record<DevelopmentReadinessState, string>;

export const OVERALL_STATUS_SURFACE_CLASS = {
  ready: 'border-emerald-300 bg-emerald-50',
  degraded: 'border-amber-300 bg-amber-50',
  blocked: 'border-red-300 bg-red-50',
} as const satisfies Record<DevelopmentReadinessState, string>;

export const OVERALL_STATUS_TEXT_CLASS = {
  ready: 'text-emerald-800',
  degraded: 'text-amber-900',
  blocked: 'text-red-800',
} as const satisfies Record<DevelopmentReadinessState, string>;

export const COMPACT_READINESS_COMPONENT_IDS = [
  'bridge',
  'baseline',
  'github',
  'executor',
] as const satisfies readonly DevelopmentReadinessComponentId[];

export const COMPACT_READINESS_LABELS: Record<
  (typeof COMPACT_READINESS_COMPONENT_IDS)[number],
  string
> = {
  bridge: 'Runtime',
  baseline: 'Репозиторий',
  github: 'GitHub',
  executor: 'Executor',
};

export const MERGE_GATE_HEADLINE = {
  pending: 'ОЖИДАЕТ РЕШЕНИЯ',
  allowed: 'МОЖНО ОБЪЕДИНИТЬ',
  blocked: 'ОБЪЕДИНЕНИЕ ЗАБЛОКИРОВАНО',
  merged: 'ОБЪЕДИНЕНО',
} as const;

export const TASK_OUTCOME_HEADLINE = {
  completed: 'ЗАВЕРШЕНО',
  failed: 'ОШИБКА',
} as const;

export function overallStatusAriaLabel(state: DevelopmentReadinessState): string {
  return `Общий статус системы: ${OVERALL_STATUS_HEADLINE[state]}`;
}

export function compactReadinessHint(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'Статус обновляется.';
  const firstSentence = trimmed.split(/(?<=[.!?])\s+/)[0]?.trim() ?? trimmed;
  return firstSentence.length > 96 ? `${firstSentence.slice(0, 93)}…` : firstSentence;
}

export function readinessShortReason(readiness: DevelopmentReadinessSnapshot): string | null {
  if (readiness.overallState === 'ready') return null;

  const blocking = DEVELOPMENT_READINESS_COMPONENTS_IN_ORDER.map((id) => readiness.components[id])
    .filter((item) => item.blockingLaunch || item.state === 'blocked');
  if (blocking.length > 0) {
    return compactReadinessHint(blocking[0]!.message);
  }

  const degraded = DEVELOPMENT_READINESS_COMPONENTS_IN_ORDER.map((id) => readiness.components[id])
    .find((item) => item.state === 'degraded');
  if (degraded) return compactReadinessHint(degraded.message);

  const blocked = DEVELOPMENT_READINESS_COMPONENTS_IN_ORDER.map((id) => readiness.components[id])
    .find((item) => item.state === 'blocked');
  if (blocked) return compactReadinessHint(blocked.message);

  return readiness.canLaunch
    ? 'Запуск возможен, но отдельные возможности требуют внимания.'
    : 'Запуск остановлен до устранения обязательных блокеров.';
}

const DEVELOPMENT_READINESS_COMPONENTS_IN_ORDER: DevelopmentReadinessComponentId[] = [
  'bridge',
  'checkouts',
  'baseline',
  'executor',
  'github',
];

export function mergeGatePresentation(gate: ControlCenterMergeGateView): {
  headline: (typeof MERGE_GATE_HEADLINE)[keyof typeof MERGE_GATE_HEADLINE];
  tone: 'pending' | 'allowed' | 'blocked' | 'merged';
  shortReason: string | null;
} {
  if (gate.merged) {
    return {
      headline: MERGE_GATE_HEADLINE.merged,
      tone: 'merged',
      shortReason: null,
    };
  }
  if (gate.mergeState === 'merge_allowed') {
    return {
      headline: MERGE_GATE_HEADLINE.allowed,
      tone: 'allowed',
      shortReason: null,
    };
  }
  if (gate.gateState === 'pending') {
    return {
      headline: MERGE_GATE_HEADLINE.pending,
      tone: 'pending',
      shortReason: gate.blocker?.message ?? 'Нужно решение владельца.',
    };
  }
  return {
    headline: MERGE_GATE_HEADLINE.blocked,
    tone: 'blocked',
    shortReason: gate.blocker?.message ?? 'Объединение пока недоступно.',
  };
}

type OverallReadinessHeroProps = {
  state: DevelopmentReadinessState;
  reason: string | null;
};

export function OverallReadinessHero({ state, reason }: OverallReadinessHeroProps) {
  return (
    <div
      role="status"
      aria-label={overallStatusAriaLabel(state)}
      data-readiness-overall-hero={state}
      className={`rounded-xl border px-4 py-5 sm:px-6 sm:py-6 ${OVERALL_STATUS_SURFACE_CLASS[state]}`}
    >
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/80 shadow-sm ${readinessStateColorClass(state)}`}
        >
          <ReadinessStateIcon state={state} className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <p
            aria-hidden="true"
            className={`text-3xl font-black tracking-wide sm:text-4xl ${OVERALL_STATUS_TEXT_CLASS[state]}`}
          >
            {OVERALL_STATUS_HEADLINE[state]}
          </p>
          {reason ? (
            <p className="mt-1 text-sm font-medium text-slate-800" data-readiness-short-reason="true">
              {reason}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type CompactReadinessItemProps = {
  label: string;
  item: DevelopmentReadinessComponent;
};

export function CompactReadinessItem({ label, item }: CompactReadinessItemProps) {
  return (
    <div
      className="rounded-lg border border-slate-200 bg-white px-3 py-3"
      data-readiness-compact-item={item.state}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{label}</h3>
        <ItemReadinessBadge state={item.state} />
      </div>
      <p className="mt-1 text-sm text-slate-700">{compactReadinessHint(item.message)}</p>
    </div>
  );
}

type ReadinessDetailsPanelProps = {
  readiness: DevelopmentReadinessSnapshot;
  checkedAtLabel: string;
};

export function ReadinessDetailsPanel({ readiness, checkedAtLabel }: ReadinessDetailsPanelProps) {
  return (
    <details className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-slate-800">Подробнее</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-slate-500">Последняя проверка: {checkedAtLabel}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {DEVELOPMENT_READINESS_COMPONENTS_IN_ORDER.map((id) => {
            const item = readiness.components[id];
            return (
              <div key={id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <DetailRow label="Компонент" value={id} mono />
                <DetailRow label="Сообщение" value={item.message} />
                <DetailRow label="reasonCode" value={item.reasonCode} mono />
                <DetailRow
                  label="blockingLaunch"
                  value={item.blockingLaunch ? 'true' : 'false'}
                />
              </div>
            );
          })}
        </div>
        {readiness.runnerEvidence ? (
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <DetailRow label="readiness version" value={readiness.runnerEvidence.schemaVersion} mono />
            <DetailRow label="runner identity" value={readiness.runnerEvidence.identity} mono />
            <DetailRow label="canonical repository" value={readiness.runnerEvidence.canonicalRepository} mono />
            <DetailRow label="repository id" value={readiness.runnerEvidence.repositoryId} mono />
            <DetailRow label="runner checkedAt" value={readiness.runnerEvidence.checkedAt} />
            <DetailRow label="runner expiresAt" value={readiness.runnerEvidence.expiresAt} />
            <DetailRow
              label="evidence age (ms)"
              value={String(readiness.runnerEvidence.evidenceAgeMs)}
            />
            <DetailRow label="readiness state" value={readiness.runnerEvidence.readinessState} />
            <DetailRow
              label="observed baseline SHA"
              value={readiness.runnerEvidence.observedBaselineSha ?? '—'}
              mono
            />
            <DetailRow
              label="verified baseline SHA"
              value={readiness.runnerEvidence.verifiedBaselineSha ?? '—'}
              mono
            />
            {readiness.runnerEvidence.blockingReason ? (
              <DetailRow label="blocking reason" value={readiness.runnerEvidence.blockingReason} />
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}

type MergeGateHeroProps = {
  gate: ControlCenterMergeGateView;
  children?: ReactNode;
};

export function MergeGateHero({ gate, children }: MergeGateHeroProps) {
  const presentation = mergeGatePresentation(gate);
  const surfaceClass =
    presentation.tone === 'allowed' || presentation.tone === 'merged'
      ? 'border-emerald-300 bg-emerald-50'
      : presentation.tone === 'pending'
        ? 'border-amber-300 bg-amber-50'
        : 'border-red-300 bg-red-50';
  const textClass =
    presentation.tone === 'allowed' || presentation.tone === 'merged'
      ? 'text-emerald-800'
      : presentation.tone === 'pending'
        ? 'text-amber-900'
        : 'text-red-800';

  return (
    <section
      className={`space-y-4 rounded-xl border p-5 shadow-sm ${surfaceClass}`}
      data-merge-gate-hero={presentation.tone}
    >
      <p className={`text-2xl font-black tracking-wide sm:text-3xl ${textClass}`}>
        {presentation.headline}
      </p>
      {presentation.shortReason ? (
        <p className="text-sm font-medium text-slate-800">{presentation.shortReason}</p>
      ) : null}
      {children}
      <details className="rounded-lg border border-slate-200 bg-white/70 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">Подробнее</summary>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <DetailRow label="gateState" value={gate.gateState} />
          <DetailRow label="mergeState" value={gate.mergeState} />
          <DetailRow label="PR" value={`${gate.repository}#${gate.pullRequestNumber}`} />
          <DetailRow label="PR URL" value={gate.pullRequestUrl} />
          <DetailRow label="Текущая версия" value={gate.currentSha} mono />
          <DetailRow label="Одобренная версия" value={gate.approvedSha ?? 'Нет'} mono />
          <DetailRow label="expected SHA" value={gate.expectedSha} mono />
          <DetailRow label="Код запроса" value={gate.mergeRequestId} mono />
          {gate.blocker ? <DetailRow label="Блокер" value={gate.blocker.message} /> : null}
        </dl>
      </details>
    </section>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`mt-0.5 break-all text-slate-900 ${mono ? 'font-mono text-xs sm:text-sm' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
