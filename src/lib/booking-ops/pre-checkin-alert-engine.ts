import type { BookingLifecycleGate, BookingLifecycleGateKey, BookingLifecycleSnapshot } from './lifecycle-types';
import type { OperatorAlertCondition, OperatorAlertSeverity } from './operator-alerts';
import { computePreCheckinReadinessSnapshot } from './pre-checkin-control-center';
import type { BookingOpsCommunicationIntent } from './types';
import type { BookingOpsTask } from './task-types';

export const PRE_CHECKIN_ALERT_SOURCE_DOMAINS = [
  'guest',
  'legal',
  'payment',
  'compliance',
  'communication',
  'booking',
] as const;

type GateAlertDefinition = {
  gateKey: BookingLifecycleGateKey;
  code: string;
  incidentFamily: string;
  sourceDomain: (typeof PRE_CHECKIN_ALERT_SOURCE_DOMAINS)[number];
  title: string;
  description: string;
  recommendedAction: string;
};

const GATE_ALERTS: GateAlertDefinition[] = [
  {
    gateKey: 'guest_data_completed', code: 'GUEST_DATA_INCOMPLETE', incidentFamily: 'GUEST_DATA', sourceDomain: 'guest',
    title: 'Данные гостя не заполнены', description: 'Для заезда не хватает обязательных данных гостя.',
    recommendedAction: 'Запросите у гостя недостающие данные.',
  },
  {
    gateKey: 'documents_verified', code: 'DOCUMENTS_NOT_VERIFIED', incidentFamily: 'DOCUMENTS', sourceDomain: 'legal',
    title: 'Документы не проверены', description: 'Документы гостя ещё не прошли проверку.',
    recommendedAction: 'Проверьте документы гостя или запросите исправления.',
  },
  {
    gateKey: 'contract_signed', code: 'CONTRACT_NOT_SIGNED', incidentFamily: 'CONTRACT', sourceDomain: 'legal',
    title: 'Договор не подписан', description: 'До заезда договор должен быть подписан.',
    recommendedAction: 'Отправьте договор или получите подпись гостя.',
  },
  {
    gateKey: 'deposit_received', code: 'DEPOSIT_NOT_RECEIVED', incidentFamily: 'DEPOSIT', sourceDomain: 'payment',
    title: 'Депозит не получен', description: 'Получение депозита ещё не подтверждено.',
    recommendedAction: 'Запросите или подтвердите получение депозита.',
  },
  {
    gateKey: 'mvd_report_submitted', code: 'MVD_NOT_SUBMITTED', incidentFamily: 'MVD', sourceDomain: 'compliance',
    title: 'Отчёт МВД не отправлен', description: 'Обязательный этап отчётности МВД не завершён.',
    recommendedAction: 'Подготовьте и отправьте отчёт МВД.',
  },
  {
    gateKey: 'checkin_instructions_sent', code: 'CHECKIN_INSTRUCTIONS_NOT_SENT', incidentFamily: 'CHECKIN_INSTRUCTIONS', sourceDomain: 'communication',
    title: 'Инструкции заезда не отправлены', description: 'Гость ещё не получил инструкции заезда.',
    recommendedAction: 'Подготовьте, проверьте и отправьте инструкции заезда.',
  },
];

const TERMINAL_BOOKING_STATUSES = new Set([
  'checked_in', 'closed', 'cancelled', 'canceled', 'completed', 'archived', 'inactive',
]);

export type PreCheckinAlertEngineInput = {
  bookingId: string;
  bookingStatus: string;
  checkInAt: string | null;
  manualNextAction?: string | null;
  lifecycleGates: BookingLifecycleGate[];
  tasks?: BookingOpsTask[];
  communications?: BookingOpsCommunicationIntent[];
  now: string;
};

function validIso(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function gateDueAt(gate: BookingLifecycleGate | undefined): string | null {
  return validIso(gate?.metadata?.dueAt ?? gate?.metadata?.due_at);
}

function gateSeverity(gate: BookingLifecycleGate | undefined, now: Date): OperatorAlertSeverity | null {
  if (gate?.status === 'completed' || gate?.status === 'skipped') return null;
  if (gate?.status === 'blocked' || gate?.status === 'failed') return 'critical';
  const dueAt = gateDueAt(gate);
  if (gate?.metadata?.overdue === true || (dueAt && new Date(dueAt).getTime() < now.getTime())) return 'critical';
  return 'warning';
}

function lifecycleSnapshot(bookingId: string, gates: BookingLifecycleGate[]): BookingLifecycleSnapshot {
  const blockedGates = gates.filter((gate) => gate.status === 'blocked' || gate.status === 'failed');
  const nextRequiredGates = gates.filter((gate) => gate.status === 'pending' || gate.status === 'in_progress').slice(0, 5);
  return {
    bookingId,
    gates,
    readinessScore: 0,
    currentActiveGate: nextRequiredGates[0] ?? null,
    blockedGates,
    completedGates: gates.filter((gate) => gate.status === 'completed'),
    nextRequiredGates,
    exceptions: [],
  };
}

function instructionsDraft(communications: BookingOpsCommunicationIntent[]): BookingOpsCommunicationIntent | null {
  return communications.find((item) =>
    (item.purpose === 'send_checkin_instructions' || item.purpose === 'checkin_instructions')
    && item.status === 'draft_ready') ?? null;
}

export function evaluatePreCheckinAlerts(input: PreCheckinAlertEngineInput): OperatorAlertCondition[] {
  const status = input.bookingStatus.trim().toLowerCase();
  const gates = new Map(input.lifecycleGates.map((gate) => [gate.gateKey, gate]));
  if (TERMINAL_BOOKING_STATUSES.has(status)
    || ['guest_checked_in', 'booking_closed'].some((key) => {
      const gate = gates.get(key as BookingLifecycleGateKey);
      return gate?.status === 'completed' || gate?.status === 'skipped';
    })) return [];

  const now = new Date(input.now);
  const checkInAt = validIso(input.checkInAt);
  const communications = input.communications ?? [];
  const readiness = computePreCheckinReadinessSnapshot({
    bookingId: input.bookingId,
    record: {
      checkInAt,
      manualNextAction: input.manualNextAction ?? null,
    },
    lifecycle: lifecycleSnapshot(input.bookingId, input.lifecycleGates),
    tasks: input.tasks ?? [],
    communications,
    now,
  });
  const minutesToCheckIn = checkInAt
    ? Math.round((new Date(checkInAt).getTime() - now.getTime()) / 60_000)
    : null;
  const draft = instructionsDraft(communications);

  const conditions = GATE_ALERTS.flatMap((definition): OperatorAlertCondition[] => {
    const gate = gates.get(definition.gateKey);
    const severity = gateSeverity(gate, now);
    if (!severity) return [];
    const draftReady = definition.gateKey === 'checkin_instructions_sent' && Boolean(draft);
    return [{
      code: definition.code,
      incidentFamily: definition.incidentFamily,
      sourceDomain: definition.sourceDomain,
      sourceGate: definition.gateKey,
      severity,
      title: definition.title,
      description: draftReady
        ? 'Черновик инструкций готов и ждёт проверки оператора перед отправкой.'
        : definition.description,
      recommendedAction: draftReady
        ? 'Проверьте готовый черновик и отправьте инструкции гостю.'
        : definition.recommendedAction,
      deadlineAt: gateDueAt(gate) ?? checkInAt,
      metadata: {
        gateStatus: gate?.status ?? 'missing',
        readinessStatus: readiness.status,
        ...(minutesToCheckIn === null ? {} : { minutesToCheckIn }),
        ...(draftReady ? { communicationState: 'draft_ready', referenceId: draft?.id } : {}),
      },
    }];
  });

  const arrivalNeedsClarification = readiness.warnings.some((item) => item.source === 'booking')
    || /время|заезд|arrival/i.test(input.manualNextAction ?? '');
  if (arrivalNeedsClarification) {
    conditions.push({
      code: 'ARRIVAL_TIME_UNCONFIRMED',
      incidentFamily: 'ARRIVAL_TIME',
      sourceDomain: 'booking',
      sourceGate: 'arrival_time',
      severity: 'warning',
      title: 'Время прибытия не подтверждено',
      description: 'Оператору нужно уточнить время прибытия гостя.',
      recommendedAction: 'Свяжитесь с гостем и подтвердите время прибытия.',
      deadlineAt: checkInAt,
      metadata: {
        readinessStatus: readiness.status,
        reasonCode: 'arrival_time_requires_clarification',
        ...(minutesToCheckIn === null ? {} : { minutesToCheckIn }),
      },
    });
  }

  return conditions;
}
