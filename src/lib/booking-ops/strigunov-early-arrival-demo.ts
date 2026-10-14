/**
 * Task02 synthetic-only composition. Not imported by application entrypoints.
 * The focused test must block the physical module's DB/service import edges.
 * No ports that can send or persist externally are accepted by this fixture.
 */
import {
  buildCanonicalRuCheckinTimeReply,
  classifyCanonicalCheckinTime,
} from '../communication/telegram-communication-canon';
import { buildOperatorHandoffDecision } from '../communication/operator-handoff-decision';
import {
  canReleaseCheckInInstructions,
  computePhysicalReadiness,
  validateCleaningTransition,
  type CleaningStatus,
} from './physical-readiness-execution';

export const DEMO_SCOPE = Object.freeze({
  accountId: 'synthetic-strigunov-account',
  bookingId: '11111111-1111-4111-8111-111111111111',
  propertyId: 'synthetic-strigunov-apartment',
  requestId: 'synthetic-early-arrival-1200',
});
export const DEMO_OPERATOR = 'synthetic-operator-1';
export const DEMO_CLEANER = 'synthetic-cleaner-1';
const TASK_ID = 'synthetic-cleaning-task-1';
const HOLD = 'Уточняем готовность квартиры. Ранний заезд пока не подтверждён.';
const DENIED = 'Ранний заезд не подтверждён. Оператор поможет согласовать другое время.';
const APPROVED = 'Готовность квартиры проверена. Оператор подтвердил заезд в 12:00.';
const MAX_AGE_MS = 5 * 60_000;

export type DemoScope = { [K in keyof typeof DEMO_SCOPE]: string };
export type DemoReadiness = {
  scope: DemoScope;
  observedAt: string;
  evidence: string;
  previousCheckoutComplete: boolean;
  legalReady: boolean;
  cleaningStatus: CleaningStatus;
  linenStatus: string;
  suppliesStatus: string;
  maintenance: Array<{ status: string; isBlocking: boolean; reason?: string }>;
};
type CommonAction = { id: string; actor: string; scope: DemoScope; evidence: string };
export type DemoAction = CommonAction & (
  | { kind: 'intake'; requestedTime: string }
  | { kind: 'acknowledge' }
  | { kind: 'cleaning'; nextStatus: CleaningStatus }
  | { kind: 'readiness'; value: DemoReadiness | null }
  | { kind: 'decision'; approved: boolean }
  | { kind: 'respond' }
);
export type DemoEvent = {
  id: string; actionId: string; at: string; actor: string; evidence: string;
  scope: DemoScope; taskId: string | null; decisionId: string | null;
  kind: string; outcome: 'pending' | 'hold' | 'approved'; detail: string;
};

/** A single booking fixture, not a persistent worker or an authorization service. */
export function createStrigunovEarlyArrivalDemo() {
  const timeline: DemoEvent[] = [];
  const replies: Array<{ id: string; text: string; scope: DemoScope; decisionId: string }> = [];
  const seen = new Map<string, string>();
  const policy = classifyCanonicalCheckinTime('12:00');
  let requested = false;
  let acknowledged = false;
  let cleaningStatus: CleaningStatus = 'pending';
  let readiness: DemoReadiness | null = null;
  let revision: string | null = null;
  let decision: { id: string; revision: string | null; approved: boolean } | null = null;
  let outcome: DemoEvent['outcome'] = 'pending';
  let reason = 'request_not_received';
  let guestResponse = HOLD;
  let lastTime = -Infinity;
  let duplicateCount = 0;
  let handoff: ReturnType<typeof buildOperatorHandoffDecision> = null;

  const scoped = (value: DemoScope) =>
    Object.keys(DEMO_SCOPE).every((key) => value?.[key as keyof DemoScope] === DEMO_SCOPE[key as keyof DemoScope]);

  function readinessBlocker(now: number): string | null {
    if (!readiness) return 'readiness_missing';
    if (!scoped(readiness.scope)) return 'readiness_scope_mismatch';
    const observed = Date.parse(readiness.observedAt);
    if (!Number.isFinite(observed) || observed > now || now - observed > MAX_AGE_MS) return 'readiness_stale_or_invalid';
    if (!readiness.evidence.trim()) return 'readiness_evidence_missing';
    if (!readiness.previousCheckoutComplete) return 'previous_checkout_unconfirmed';
    if (readiness.cleaningStatus !== cleaningStatus) return 'cleaning_snapshot_mismatch';
    const physical = computePhysicalReadiness({ ...readiness, finalApproved: true });
    const gate = canReleaseCheckInInstructions({ legalReady: readiness.legalReady, physical });
    return gate.allowed ? null : gate.blockerKeys.join(',');
  }

  const snapshot = () => structuredClone({
    synthetic: true as const, externalIntegration: 'not_integrated' as const,
    scope: DEMO_SCOPE, requestedTime: '12:00', policy, outcome, reason, guestResponse,
    task: requested ? { id: TASK_ID, assignedTo: DEMO_CLEANER, acknowledged, cleaningStatus } : null,
    decision, handoff, timeline, replies, duplicateCount,
  });

  function step(action: DemoAction, at: string) {
    const now = Date.parse(at);
    if (!Number.isFinite(now) || now < lastTime) throw new Error('demo_time_invalid');
    if (!scoped(action.scope)) throw new Error('demo_scope_mismatch');
    if (!action.id.startsWith('synthetic-') || !action.evidence.trim()) throw new Error('demo_action_evidence_invalid');
    const payload = JSON.stringify(action);
    if (seen.has(action.id)) {
      if (seen.get(action.id) !== payload) throw new Error('demo_action_replay_conflict');
      duplicateCount++;
      return snapshot();
    }
    if (action.kind !== 'intake' && !requested) throw new Error('demo_request_required');
    if (action.kind === 'intake' && action.actor !== 'synthetic-guest') throw new Error('demo_guest_required');
    if (['acknowledge', 'decision', 'readiness'].includes(action.kind) && action.actor !== DEMO_OPERATOR) {
      throw new Error('demo_operator_required');
    }
    if (action.kind === 'cleaning') {
      const expectedActor = action.nextStatus === 'verified' ? DEMO_OPERATOR : DEMO_CLEANER;
      if (action.actor !== expectedActor) throw new Error('demo_cleaning_actor_invalid');
      if (!acknowledged) throw new Error('demo_acknowledgment_required');
      if (!['pending', 'assigned', 'in_progress', 'completed', 'verified', 'blocked', 'cancelled'].includes(action.nextStatus)) {
        throw new Error('demo_cleaning_status_invalid');
      }
      validateCleaningTransition({ currentStatus: cleaningStatus, nextStatus: action.nextStatus, hasExecutor: true });
    }
    if (action.kind === 'respond' && action.actor !== 'synthetic-system') throw new Error('demo_system_required');
    if (action.kind === 'intake' && action.requestedTime !== '12:00') throw new Error('demo_only_1200');
    if (action.kind === 'readiness' && action.value && !scoped(action.value.scope)) throw new Error('demo_readiness_scope_mismatch');

    lastTime = now;
    seen.set(action.id, payload);
    const record = (kind: string, detail: string) => timeline.push({
      id: 'synthetic-event-' + (timeline.length + 1), actionId: action.id, at, actor: action.actor,
      evidence: action.evidence, scope: { ...DEMO_SCOPE }, taskId: requested ? TASK_ID : null,
      decisionId: decision?.id ?? null, kind, outcome, detail,
    });

    switch (action.kind) {
      case 'intake': {
        if (requested) { record('request_already_linked', 'Одна бронь, одна задача; повтор не создаёт новую.'); break; }
        requested = true;
        reason = 'operator_and_readiness_required';
        guestResponse = buildCanonicalRuCheckinTimeReply({ bucket: policy.bucket, time: '12:00', hasProperty: true });
        handoff = buildOperatorHandoffDecision({
          channel: 'telegram', transport: 'synthetic-sink', guestMessage: 'Приедем в 12:00, можно заселиться раньше?',
          bookingId: DEMO_SCOPE.bookingId, propertyId: DEMO_SCOPE.propertyId,
          sessionId: DEMO_SCOPE.requestId, guestIdentity: 'synthetic-guest',
          autopilot: {
            action: 'escalate', confidence: 1, replyText: HOLD, escalationReason: 'early_checkin_requires_operator',
            metadata: { intent: 'early_checkin_late_checkout', matchedSignals: ['12:00'], missingContext: [],
              contextKeys: ['booking', 'property'], channelMode: 'foundation', urgent: false, policy: 'deterministic_mvp_v1' },
          },
        });
        record('guest_request_and_policy', guestResponse);
        record('operator_handoff_and_assignment', 'Запрос передан оператору; назначена одна синтетическая задача уборки.');
        break;
      }
      case 'acknowledge':
        acknowledged = true;
        record('operator_acknowledged', 'Оператор принял запрос и подтвердил ответственного за уборку.');
        break;
      case 'cleaning':
        cleaningStatus = action.nextStatus;
        decision = null; outcome = 'hold'; reason = 'readiness_and_decision_recheck_required'; guestResponse = HOLD;
        record('cleaning_' + cleaningStatus, cleaningStatus === 'blocked' ? 'Исполнитель отказался или сообщил о препятствии; подтверждение запрещено.' : 'Состояние уборки: ' + cleaningStatus);
        break;
      case 'readiness':
        readiness = action.value ? structuredClone(action.value) : null;
        revision = action.id;
        decision = null; outcome = 'hold'; guestResponse = HOLD;
        reason = readinessBlocker(now) ?? 'operator_decision_required';
        record('readiness_observed', reason);
        break;
      case 'decision': {
        const blocker = !acknowledged ? 'operator_acknowledgment_missing' : readinessBlocker(now);
        if (action.approved && blocker) {
          decision = null; outcome = 'hold'; reason = blocker; guestResponse = HOLD;
          record('operator_approval_rejected', reason);
        } else {
          decision = { id: action.id, revision, approved: action.approved };
          outcome = action.approved ? 'approved' : 'hold';
          reason = action.approved ? 'scoped_operator_approved' : 'operator_declined';
          guestResponse = action.approved ? HOLD : DENIED; // Promise only after final recheck.
          record(action.approved ? 'operator_approved' : 'operator_declined', reason);
        }
        break;
      }
      case 'respond': {
        const blocker = readinessBlocker(now)
          ?? (!decision?.approved || decision.revision !== revision ? 'operator_approval_missing' : null);
        if (blocker) {
          outcome = 'hold'; reason = blocker;
          guestResponse = decision?.approved === false ? DENIED : HOLD;
          decision = null;
          record('guest_response_held', guestResponse + ' Причина: ' + reason);
          break;
        }
        outcome = 'approved'; reason = 'fresh_gates_and_operator_approved'; guestResponse = APPROVED;
        record('readiness_rechecked_before_reply', reason);
        if (!replies.length) {
          replies.push({ id: 'synthetic-reply-1', text: APPROVED, scope: { ...DEMO_SCOPE }, decisionId: decision!.id });
          record('synthetic_reply_recorded', APPROVED);
        } else {
          record('duplicate_reply_suppressed', 'Ответ уже записан; повторная доставка запрещена.');
        }
        break;
      }
    }
    return snapshot();
  }
  return { step, snapshot };
}

/** Deterministic fixture script: the focused test is the reviewed execution entrypoint. */
export function runStrigunovEarlyArrivalDemo() {
  const demo = createStrigunovEarlyArrivalDemo();
  const base = { scope: { ...DEMO_SCOPE }, evidence: 'synthetic-fixture-only' };
  const apply = (action: Omit<DemoAction, keyof CommonAction> & Record<string, unknown>, actor: string, minute: number) =>
    demo.step({ ...base, ...action, id: 'synthetic-script-' + minute, actor } as DemoAction,
      '2026-10-11T08:' + String(minute).padStart(2, '0') + ':00.000Z');
  apply({ kind: 'intake', requestedTime: '12:00' }, 'synthetic-guest', 40);
  apply({ kind: 'respond' }, 'synthetic-system', 41);
  apply({ kind: 'acknowledge' }, DEMO_OPERATOR, 42);
  apply({ kind: 'cleaning', nextStatus: 'assigned' }, DEMO_CLEANER, 43);
  apply({ kind: 'cleaning', nextStatus: 'in_progress' }, DEMO_CLEANER, 44);
  apply({ kind: 'cleaning', nextStatus: 'completed' }, DEMO_CLEANER, 45);
  apply({ kind: 'cleaning', nextStatus: 'verified' }, DEMO_OPERATOR, 46);
  apply({ kind: 'readiness', value: {
    scope: { ...DEMO_SCOPE }, observedAt: '2026-10-11T08:47:00.000Z', evidence: 'synthetic-inspection-and-checkout',
    previousCheckoutComplete: true, legalReady: true, cleaningStatus: 'verified', linenStatus: 'verified',
    suppliesStatus: 'verified', maintenance: [],
  } }, DEMO_OPERATOR, 47);
  apply({ kind: 'decision', approved: true }, DEMO_OPERATOR, 48);
  apply({ kind: 'respond' }, 'synthetic-system', 49);
  apply({ kind: 'respond' }, 'synthetic-system', 50);
  return demo.snapshot();
}
