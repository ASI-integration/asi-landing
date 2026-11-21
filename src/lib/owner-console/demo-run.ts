import type { OwnerLang } from '@/lib/owner-console/context';

export const DEMO_SCENARIO = 'hospitality-checkout';
export const DEMO_STEP_MS = 1200;
export const DEMO_WINDOW_SEC = 60;

export const DEMO_STEP_IDS = ['received', 'verified', 'assigned', 'logged'] as const;
export type DemoStepId = (typeof DEMO_STEP_IDS)[number];
export type DemoStepState = 'pending' | 'active' | 'done';

const PAID_FIELD = /^(prompt|model|messages|tools|temperature|max_tokens|provider)$/i;

export interface DemoStepView {
  id: DemoStepId;
  state: DemoStepState;
  title: string;
  detail: string;
}

export interface DemoAuditEntry {
  id: string;
  at: string;
  title: string;
  summary: string;
  currency: 'USD' | 'RUB';
  total: number;
  lines: Array<{ label: string; amount: number }>;
  immutable: true;
}

export interface DemoSnapshot {
  ok: true;
  sandbox: true;
  llmTokens: 0;
  scenario: typeof DEMO_SCENARIO;
  runId: string;
  lang: OwnerLang;
  startedAt: string;
  elapsedMs: number;
  windowSec: number;
  done: boolean;
  steps: DemoStepView[];
  audit: DemoAuditEntry | null;
}

interface DemoRun {
  runId: string;
  lang: OwnerLang;
  startedAtMs: number;
}

const runs = new Map<string, DemoRun>();
const MAX_RUNS = 200;

const COPY = {
  en: {
    titles: [
      'Event Received (Guest Checkout)',
      'Condition Verified',
      'Housekeeping & Checklist Auto-Assigned',
      'Operation Cost & Immutable Audit Entry Logged',
    ],
    details: [
      'Cabin 412 checkout accepted at 11:02. Guest departure is the only trigger.',
      'Room check: used linen, minibar short two items, no damage.',
      'Housekeeper A. Petrova assigned with checklist HK-14. Due in 45 minutes.',
      'Cost posted to the audit journal. The entry is immutable for this demo run.',
    ],
    auditTitle: 'Checkout turnover — cabin 412',
    auditSummary: '60-second hospitality turnover recorded without a paid model call.',
    lines: [
      { label: 'Linen reset', amount: 18 },
      { label: 'Minibar restock', amount: 7 },
      { label: 'Housekeeping, 30 min', amount: 14 },
    ],
    currency: 'USD' as const,
  },
  ru: {
    titles: [
      'Событие получено (выезд гостя)',
      'Состояние проверено',
      'Горничная и чек-лист назначены',
      'Себестоимость и неизменяемая запись аудита сохранены',
    ],
    details: [
      'Выезд из номера 412 принят в 11:02. Других триггеров нет.',
      'Проверка: бельё использовано, в мини-баре не хватает двух позиций, повреждений нет.',
      'Горничная А. Петрова назначена с чек-листом HK-14. Срок — 45 минут.',
      'Себестоимость записана в журнал. Запись этого прогона не редактируется.',
    ],
    auditTitle: 'Оборот после выезда — номер 412',
    auditSummary: '60-секундный сценарий гостеприимства записан без платного вызова модели.',
    lines: [
      { label: 'Замена белья', amount: 450 },
      { label: 'Пополнение мини-бара', amount: 180 },
      { label: 'Горничная, 30 мин', amount: 360 },
    ],
    currency: 'RUB' as const,
  },
};

function shownSteps(elapsedMs: number): number {
  if (elapsedMs < 0) return 0;
  return Math.min(DEMO_STEP_IDS.length, Math.floor(elapsedMs / DEMO_STEP_MS) + 1);
}

function snapshot(run: DemoRun, nowMs: number): DemoSnapshot {
  const copy = COPY[run.lang];
  const elapsedMs = Math.max(0, nowMs - run.startedAtMs);
  const revealed = shownSteps(elapsedMs);
  const done = elapsedMs >= DEMO_STEP_MS * DEMO_STEP_IDS.length;
  const steps: DemoStepView[] = DEMO_STEP_IDS.map((id, index) => {
    const state: DemoStepState = done
      ? 'done'
      : index < revealed - 1
        ? 'done'
        : index === revealed - 1
          ? 'active'
          : 'pending';
    return {
      id,
      state,
      title: copy.titles[index],
      detail: state === 'pending' ? '' : copy.details[index],
    };
  });
  const total = copy.lines.reduce((sum, line) => sum + line.amount, 0);
  const audit: DemoAuditEntry | null = done
    ? {
        id: `audit_${run.runId}`,
        at: new Date(run.startedAtMs + DEMO_STEP_IDS.length * DEMO_STEP_MS).toISOString(),
        title: copy.auditTitle,
        summary: copy.auditSummary,
        currency: copy.currency,
        total,
        lines: copy.lines,
        immutable: true,
      }
    : null;
  return {
    ok: true,
    sandbox: true,
    llmTokens: 0,
    scenario: DEMO_SCENARIO,
    runId: run.runId,
    lang: run.lang,
    startedAt: new Date(run.startedAtMs).toISOString(),
    elapsedMs,
    windowSec: DEMO_WINDOW_SEC,
    done,
    steps,
    audit,
  };
}

export function assertSandboxBody(body: unknown): { lang: OwnerLang } {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { lang: 'en' };
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (PAID_FIELD.test(key)) {
      throw new SandboxRejectedError();
    }
  }
  if ('scenario' in record && record.scenario !== DEMO_SCENARIO) {
    throw new SandboxRejectedError();
  }
  const lang = record.lang === 'ru' ? 'ru' : 'en';
  return { lang };
}

export class SandboxRejectedError extends Error {
  constructor() {
    super('sandbox_only');
    this.name = 'SandboxRejectedError';
  }
}

function remember(run: DemoRun) {
  runs.set(run.runId, run);
  if (runs.size <= MAX_RUNS) return;
  const oldest = runs.keys().next().value;
  if (oldest) runs.delete(oldest);
}

export function startDemoRun(lang: OwnerLang, nowMs = Date.now()): DemoSnapshot {
  const run: DemoRun = {
    runId: crypto.randomUUID(),
    lang,
    startedAtMs: nowMs,
  };
  remember(run);
  return snapshot(run, nowMs);
}

export function readDemoRun(runId: string, nowMs = Date.now()): DemoSnapshot | null {
  const run = runs.get(runId);
  if (!run) return null;
  return snapshot(run, nowMs);
}

export function resetDemoRunsForTests() {
  runs.clear();
}
