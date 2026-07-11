export const TURNOVER_SLA_DEFAULTS_MINUTES = Object.freeze({
  cleaning: 90,
  linen: 60,
  inspection: 30,
  readiness: 20,
});

export const OPS_ALERT_THRESHOLDS_MINUTES = Object.freeze({
  approachingDeadline: 60,
  imminentCheckIn: 45,
});

export type OpsAlertSeverity = 'info' | 'warning' | 'critical';
export type OpsAlertGate = 'cleaning' | 'linen' | 'inspection' | 'maintenance' | 'readiness';
export type OpsAlertCode =
  | 'CLEANING_TASK_MISSING' | 'CLEANING_NOT_ACCEPTED' | 'CLEANING_NOT_STARTED' | 'CLEANING_OVERDUE'
  | 'LINEN_TASK_MISSING' | 'LINEN_NOT_CONFIRMED' | 'LINEN_OVERDUE'
  | 'INSPECTION_TASK_MISSING' | 'INSPECTION_NOT_STARTED' | 'INSPECTION_FAILED' | 'INSPECTION_OVERDUE'
  | 'MAINTENANCE_BLOCKER_ACTIVE' | 'UNIT_NOT_READY_WARNING' | 'UNIT_NOT_READY_CRITICAL' | 'READY_DEADLINE_MISSED';

export type OpsTaskState = { status: string; assigned?: boolean } | null;
export type OpsTurnoverEvaluationInput = {
  turnoverId: string;
  propertyId: string;
  previousBookingId?: string | null;
  nextBookingId: string;
  checkoutAt?: string | null;
  nextCheckInAt?: string | null;
  now: string;
  cleaning: OpsTaskState;
  linen: OpsTaskState;
  inspection: OpsTaskState;
  maintenance: Array<{ id?: string; isBlocking: boolean; status: string }>;
  finalReady: boolean;
  active?: boolean;
};
export type OpsAlertCondition = {
  code: OpsAlertCode;
  gate: OpsAlertGate;
  severity: OpsAlertSeverity;
  title: string;
  description: string;
  deadlineAt: string;
  nextCheckInAt: string;
  dedupeKey: string;
  metadata: Record<string, unknown>;
};

function minusMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() - minutes * 60_000).toISOString();
}

export function calculateTurnoverDeadlines(nextCheckInAt: string, offsets = TURNOVER_SLA_DEFAULTS_MINUTES) {
  const parsed = new Date(nextCheckInAt);
  if (Number.isNaN(parsed.getTime())) throw new Error('next_check_in_invalid');
  const checkIn = parsed.toISOString();
  return {
    nextCheckInAt: checkIn,
    cleaningDeadlineAt: minusMinutes(checkIn, offsets.cleaning),
    linenDeadlineAt: minusMinutes(checkIn, offsets.linen),
    inspectionDeadlineAt: minusMinutes(checkIn, offsets.inspection),
    readyDeadlineAt: minusMinutes(checkIn, offsets.readiness),
  };
}

const complete = {
  cleaning: new Set(['completed', 'verified']),
  linen: new Set(['delivered', 'verified']),
  inspection: new Set(['completed', 'done', 'passed', 'verified']),
};

export function evaluateOpsTurnover(input: OpsTurnoverEvaluationInput): { deadlines: ReturnType<typeof calculateTurnoverDeadlines> | null; conditions: OpsAlertCondition[] } {
  if (input.active === false || !input.nextCheckInAt) return { deadlines: null, conditions: [] };
  const deadlines = calculateTurnoverDeadlines(input.nextCheckInAt);
  const nowMs = new Date(input.now).getTime();
  if (Number.isNaN(nowMs)) throw new Error('now_invalid');
  const checkInMs = new Date(deadlines.nextCheckInAt).getTime();
  const minutesToCheckIn = Math.floor((checkInMs - nowMs) / 60_000);
  const conditions: OpsAlertCondition[] = [];
  const incidentFamily = (code: OpsAlertCode) => code.startsWith('CLEANING_') ? 'CLEANING_DELAY'
    : code.startsWith('LINEN_') ? 'LINEN_DELAY'
      : code.startsWith('INSPECTION_') ? 'INSPECTION_DELAY'
        : code.startsWith('UNIT_NOT_READY_') || code === 'READY_DEADLINE_MISSED' ? 'READINESS_DELAY'
          : code;
  const add = (code: OpsAlertCode, gate: OpsAlertGate, deadlineAt: string, severity: OpsAlertSeverity, title: string, description: string) => conditions.push({
    code, gate, deadlineAt, severity, title, description, nextCheckInAt: deadlines.nextCheckInAt,
    dedupeKey: `${input.turnoverId}:${input.propertyId}:${incidentFamily(code)}:${gate}:${input.nextBookingId}`,
    metadata: { minutesToCheckIn, checkoutAt: input.checkoutAt ?? null, previousBookingId: input.previousBookingId ?? null },
  });
  const severityFor = (deadlineAt: string): OpsAlertSeverity => nowMs >= new Date(deadlineAt).getTime() || minutesToCheckIn <= OPS_ALERT_THRESHOLDS_MINUTES.imminentCheckIn ? 'critical' : 'warning';

  if (!input.cleaning) add('CLEANING_TASK_MISSING', 'cleaning', deadlines.cleaningDeadlineAt, severityFor(deadlines.cleaningDeadlineAt), 'Уборка не создана', 'Создайте и назначьте уборку до следующего заезда.');
  else if (!complete.cleaning.has(input.cleaning.status)) {
    const overdue = nowMs >= new Date(deadlines.cleaningDeadlineAt).getTime();
    const code = overdue ? 'CLEANING_OVERDUE' : !input.cleaning.assigned ? 'CLEANING_NOT_ACCEPTED' : input.cleaning.status === 'in_progress' ? 'CLEANING_NOT_STARTED' : 'CLEANING_NOT_STARTED';
    add(code, 'cleaning', deadlines.cleaningDeadlineAt, severityFor(deadlines.cleaningDeadlineAt), overdue ? 'Уборка просрочена' : !input.cleaning.assigned ? 'Уборка не принята' : 'Уборка не завершена', 'Проверьте исполнителя и завершите уборку в срок.');
  }
  if (!input.linen) add('LINEN_TASK_MISSING', 'linen', deadlines.linenDeadlineAt, severityFor(deadlines.linenDeadlineAt), 'Подготовка белья не создана', 'Создайте задачу на подготовку белья.');
  else if (!complete.linen.has(input.linen.status)) add(nowMs >= new Date(deadlines.linenDeadlineAt).getTime() ? 'LINEN_OVERDUE' : 'LINEN_NOT_CONFIRMED', 'linen', deadlines.linenDeadlineAt, severityFor(deadlines.linenDeadlineAt), 'Бельё не подтверждено', 'Подтвердите готовность белья до заезда.');
  if (!input.inspection) add('INSPECTION_TASK_MISSING', 'inspection', deadlines.inspectionDeadlineAt, severityFor(deadlines.inspectionDeadlineAt), 'Осмотр не создан', 'Создайте задачу на финальный осмотр.');
  else if (!complete.inspection.has(input.inspection.status)) {
    const failed = ['failed', 'issue_found', 'blocked'].includes(input.inspection.status);
    add(failed ? 'INSPECTION_FAILED' : nowMs >= new Date(deadlines.inspectionDeadlineAt).getTime() ? 'INSPECTION_OVERDUE' : 'INSPECTION_NOT_STARTED', 'inspection', deadlines.inspectionDeadlineAt, failed || severityFor(deadlines.inspectionDeadlineAt) === 'critical' ? 'critical' : 'warning', failed ? 'Осмотр не пройден' : 'Осмотр не завершён', failed ? 'Устраните замечания и повторите осмотр.' : 'Завершите осмотр до заезда.');
  }
  if (input.maintenance.some((issue) => issue.isBlocking && !['resolved', 'verified', 'cancelled'].includes(issue.status))) add('MAINTENANCE_BLOCKER_ACTIVE', 'maintenance', deadlines.readyDeadlineAt, severityFor(deadlines.readyDeadlineAt), 'Есть блокирующая неисправность', 'Устраните блокирующую неисправность до готовности объекта.');
  if (!input.finalReady) {
    const missed = nowMs >= new Date(deadlines.readyDeadlineAt).getTime();
    const code: OpsAlertCode = missed ? 'READY_DEADLINE_MISSED' : minutesToCheckIn <= OPS_ALERT_THRESHOLDS_MINUTES.imminentCheckIn ? 'UNIT_NOT_READY_CRITICAL' : 'UNIT_NOT_READY_WARNING';
    add(code, 'readiness', deadlines.readyDeadlineAt, missed || code === 'UNIT_NOT_READY_CRITICAL' ? 'critical' : 'warning', missed ? 'Срок готовности пропущен' : 'Объект ещё не готов', 'Завершите все обязательные этапы. Подтверждение уведомления не меняет готовность.');
  }
  return { deadlines, conditions };
}
