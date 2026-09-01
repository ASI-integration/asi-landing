import type { ReactNode } from 'react';
import type { ControlCenterMergeGateView } from '@/lib/development/owner-merge-gate';
import type {
  DevelopmentReadinessComponent,
  DevelopmentReadinessComponentId,
  DevelopmentReadinessSnapshot,
  DevelopmentReadinessState,
} from '@/lib/development/readiness-types';

export const TRAFFIC_LIGHT_STATUS_LABELS = {
  ready: 'ГОТОВО',
  degraded: 'ВНИМАНИЕ',
  blocked: 'СТОП',
} as const satisfies Record<DevelopmentReadinessState, string>;

export const TASK_TERMINAL_HEADLINE_LABELS = {
  completed: 'ЗАВЕРШЕНО',
  failed: 'ОШИБКА',
} as const;

export const MERGE_GATE_HEADLINE_LABELS = {
  pending: 'ОЖИДАЕТ РЕШЕНИЯ',
  allowed: 'МОЖНО ОБЪЕДИНИТЬ',
  blocked: 'ОБЪЕДИНЕНИЕ ЗАБЛОКИРОВАНО',
} as const;

export type DisplayReadinessGroupId = 'runtime' | 'repository' | 'github' | 'executor';

export const DISPLAY_READINESS_GROUPS: ReadonlyArray<{
  id: DisplayReadinessGroupId;
  label: string;
  componentIds: readonly DevelopmentReadinessComponentId[];
}> = [
  { id: 'runtime', label: 'Runtime', componentIds: ['bridge'] },
  { id: 'repository', label: 'Репозиторий', componentIds: ['checkouts', 'baseline'] },
  { id: 'github', label: 'GitHub', componentIds: ['github'] },
  { id: 'executor', label: 'Executor', componentIds: ['executor'] },
];

const STATE_PRIORITY: Record<DevelopmentReadinessState, number> = {
  blocked: 3,
  degraded: 2,
  ready: 1,
};

const TRAFFIC_LIGHT_BG_CLASS = {
  ready: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  degraded: 'border-amber-300 bg-amber-50 text-amber-900',
  blocked: 'border-red-300 bg-red-50 text-red-800',
} as const satisfies Record<DevelopmentReadinessState, string>;

const TRAFFIC_LIGHT_DOT_CLASS = {
  ready: 'bg-emerald-500',
  degraded: 'bg-amber-400',
  blocked: 'bg-red-500',
} as const satisfies Record<DevelopmentReadinessState, string>;

export function trafficLightStatusLabel(state: DevelopmentReadinessState): string {
  return TRAFFIC_LIGHT_STATUS_LABELS[state];
}

export function trafficLightAriaLabel(state: DevelopmentReadinessState): string {
  return `Общий статус системы: ${TRAFFIC_LIGHT_STATUS_LABELS[state]}`;
}

export function trafficLightBackgroundClass(state: DevelopmentReadinessState): string {
  return TRAFFIC_LIGHT_BG_CLASS[state];
}

export function trafficLightDotClass(state: DevelopmentReadinessState): string {
  return TRAFFIC_LIGHT_DOT_CLASS[state];
}

export function combineReadinessStates(
  states: DevelopmentReadinessState[],
): DevelopmentReadinessState {
  if (states.some((state) => state === 'blocked')) return 'blocked';
  if (states.some((state) => state === 'degraded')) return 'degraded';
  return 'ready';
}

export function resolveDisplayReadinessGroup(input: {
  groupId: DisplayReadinessGroupId;
  readiness: DevelopmentReadinessSnapshot;
}): {
  state: DevelopmentReadinessState;
  message: string;
  components: Array<{ id: DevelopmentReadinessComponentId; item: DevelopmentReadinessComponent }>;
} {
  const group = DISPLAY_READINESS_GROUPS.find((entry) => entry.id === input.groupId);
  if (!group) {
    return { state: 'blocked', message: 'Проверка недоступна.', components: [] };
  }

  const components = group.componentIds.map((id) => ({
    id,
    item: input.readiness.components[id],
  }));
  const state = combineReadinessStates(components.map((entry) => entry.item.state));
  const message = pickShortGroupMessage(components, state);
  return { state, message, components };
}

function pickShortGroupMessage(
  components: Array<{ id: DevelopmentReadinessComponentId; item: DevelopmentReadinessComponent }>,
  state: DevelopmentReadinessState,
): string {
  if (state === 'ready') {
    return components[0]?.item.message ?? 'Готово.';
  }

  const blocked = components.find((entry) => entry.item.state === 'blocked');
  if (blocked) return blocked.item.message;

  const degraded = components.find((entry) => entry.item.state === 'degraded');
  if (degraded) return degraded.item.message;

  return components[0]?.item.message ?? 'Требует внимания.';
}

export function readinessShortReason(readiness: DevelopmentReadinessSnapshot): string | null {
  if (readiness.overallState === 'ready') return null;

  const groups = DISPLAY_READINESS_GROUPS.map((group) =>
    resolveDisplayReadinessGroup({ groupId: group.id, readiness }),
  );
  const blocked = groups.find((group) => group.state === 'blocked');
  if (blocked) return blocked.message;
  const degraded = groups.find((group) => group.state === 'degraded');
  return degraded?.message ?? null;
}

export function mergeGateHeadline(gate: ControlCenterMergeGateView): {
  label: string;
  state: 'pending' | 'allowed' | 'blocked';
} {
  if (gate.merged) {
    return { label: MERGE_GATE_HEADLINE_LABELS.allowed, state: 'allowed' };
  }
  if (gate.mergeState === 'merge_allowed' && gate.gateState === 'passed') {
    return { label: MERGE_GATE_HEADLINE_LABELS.allowed, state: 'allowed' };
  }
  if (gate.gateState === 'pending') {
    return { label: MERGE_GATE_HEADLINE_LABELS.pending, state: 'pending' };
  }
  return { label: MERGE_GATE_HEADLINE_LABELS.blocked, state: 'blocked' };
}

type TrafficLightHeroProps = {
  state: DevelopmentReadinessState;
  reason?: string | null;
  busy?: boolean;
};

export function TrafficLightHero({ state, reason, busy = false }: TrafficLightHeroProps) {
  const label = trafficLightStatusLabel(state);
  return (
    <div
      role="status"
      aria-label={trafficLightAriaLabel(state)}
      data-traffic-light-status={state}
      className={`rounded-2xl border px-5 py-6 text-center shadow-sm ${trafficLightBackgroundClass(state)}`}
    >
      <div className="flex items-center justify-center gap-3">
        <span
          aria-hidden="true"
          className={`inline-block h-5 w-5 rounded-full ${trafficLightDotClass(state)}`}
        />
        <p className="text-3xl font-black tracking-wide sm:text-4xl" aria-hidden="true">
          {label}
        </p>
      </div>
      {reason ? (
        <p className="mt-3 text-sm font-medium" data-traffic-light-reason="true">
          {reason}
        </p>
      ) : null}
      {busy ? (
        <p className="mt-2 text-xs font-medium opacity-80" data-traffic-light-refresh="true">
          Обновление…
        </p>
      ) : null}
    </div>
  );
}

type CompactReadinessRowProps = {
  label: string;
  state: DevelopmentReadinessState;
  message: string;
};

export function CompactReadinessRow({ label, state, message }: CompactReadinessRowProps) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
      data-readiness-group={label}
    >
      <span
        aria-hidden="true"
        className={`mt-1 inline-block h-3 w-3 shrink-0 rounded-full ${trafficLightDotClass(state)}`}
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-slate-700">{message}</p>
      </div>
      <span className="sr-only">{`Статус ${label}: ${trafficLightStatusLabel(state)}`}</span>
    </div>
  );
}

type MergeGateHeroProps = {
  label: string;
  state: 'pending' | 'allowed' | 'blocked';
  reason?: string | null;
  children?: ReactNode;
};

export function MergeGateHero({ label, state, reason, children }: MergeGateHeroProps) {
  const visualState: DevelopmentReadinessState = state === 'allowed'
    ? 'ready'
    : state === 'pending'
      ? 'degraded'
      : 'blocked';

  return (
    <section
      className={`space-y-4 rounded-xl border p-5 shadow-sm ${trafficLightBackgroundClass(visualState)}`}
      data-merge-gate-state={state}
    >
      <p className="text-center text-2xl font-black tracking-wide sm:text-3xl">{label}</p>
      {reason ? <p className="text-center text-sm font-medium">{reason}</p> : null}
      {children}
    </section>
  );
}
