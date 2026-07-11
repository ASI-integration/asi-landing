export const BOOKING_LIFECYCLE_STAGES = [
  'booking_received', 'guest_contacted', 'guest_data_requested', 'guest_data_completed',
  'documents_requested', 'documents_received', 'documents_verified', 'contract_generated',
  'deposit_requested', 'deposit_confirmed', 'mvd_completed', 'turnover_created',
  'cleaning_completed', 'linen_completed', 'consumables_completed', 'inspection_completed',
  'maintenance_completed', 'property_ready', 'checkin_released', 'checked_in', 'in_stay',
  'checkout_started', 'checkout_inspected', 'deposit_returned', 'closed',
] as const;

export type BookingLifecycleStage = (typeof BOOKING_LIFECYCLE_STAGES)[number];
export type BookingEventActor = 'guest' | 'operator' | 'cleaner' | 'linen_worker' | 'consumables' | 'inspector' | 'maintenance_technician' | 'system';
export type WorkerTaskRole = 'cleaner' | 'linen_worker' | 'consumables' | 'inspector' | 'maintenance_technician';
export type WorkerTaskStatus = 'pending' | 'assigned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export type LifecycleEvent = {
  id: string; bookingId: string; objectId?: string | null; type: string; actorType: BookingEventActor;
  actorId?: string | null; payload: Record<string, unknown>; source: string; correlationId: string;
  causationId?: string | null; createdAt: string;
};

export type LifecycleTask = {
  key: string; role: WorkerTaskRole; status: WorkerTaskStatus; deadline?: string | null;
  checklist: Array<{ key: string; label: string; completed: boolean }>;
  notes?: string | null; photos?: Array<{ id: string; storageKey?: string; name?: string; contentType?: string }>;
  issue?: { summary: string; blocking: boolean } | null;
};

export type LifecycleState = {
  stage: BookingLifecycleStage; completed: BookingLifecycleStage[]; tasks: LifecycleTask[];
  readiness: 'blocked' | 'ready'; blockers: string[]; maintenanceRequired: boolean;
  inspectionRequired: boolean; audit: Array<{ eventId: string; decision: string }>;
};

export type LifecycleDecision = { state: LifecycleState; tasksToCreate: LifecycleTask[]; eventsToEmit: string[]; duplicate: boolean };

const task = (role: WorkerTaskRole, bookingId: string): LifecycleTask => ({
  key: `${bookingId}:${role}`, role, status: 'pending',
  checklist: [{ key: 'work_complete', label: 'Работа выполнена', completed: false }],
});

export function initialLifecycleState(): LifecycleState {
  return { stage: 'booking_received', completed: [], tasks: [], readiness: 'blocked', blockers: ['guest_data'], maintenanceRequired: false, inspectionRequired: false, audit: [] };
}

function complete(state: LifecycleState, stage: BookingLifecycleStage) {
  if (!state.completed.includes(stage)) state.completed.push(stage);
  state.stage = stage;
}

function ensureTask(state: LifecycleState, role: WorkerTaskRole, bookingId: string, created: LifecycleTask[]) {
  if (state.tasks.some((item) => item.key === `${bookingId}:${role}` && item.status !== 'cancelled')) return;
  const next = task(role, bookingId); state.tasks.push(next); created.push(next);
}

function finishTask(state: LifecycleState, role: WorkerTaskRole) {
  const current = state.tasks.find((item) => item.role === role && item.status !== 'cancelled');
  if (current) { current.status = 'completed'; current.checklist = current.checklist.map((item) => ({ ...item, completed: true })); }
}

function recompute(state: LifecycleState) {
  const required: WorkerTaskRole[] = ['cleaner', 'linen_worker', 'consumables', 'inspector'];
  if (state.maintenanceRequired) required.push('maintenance_technician');
  state.blockers = required.filter((role) => !state.tasks.some((item) => item.role === role && item.status === 'completed'));
  if (state.inspectionRequired) state.blockers.push('reinspection_required');
  state.readiness = state.blockers.length === 0 ? 'ready' : 'blocked';
}

function legalGatesComplete(state: LifecycleState) {
  return ['guest_data_completed', 'documents_verified', 'contract_generated', 'deposit_confirmed', 'mvd_completed']
    .every((stage) => state.completed.includes(stage as BookingLifecycleStage));
}

function ensureTurnover(state: LifecycleState, bookingId: string, created: LifecycleTask[], emitted: string[]) {
  if (!legalGatesComplete(state)) return;
  for (const role of ['cleaner', 'linen_worker', 'consumables', 'inspector'] as WorkerTaskRole[]) ensureTask(state, role, bookingId, created);
  complete(state, 'turnover_created');
  emitted.push('turnover.tasks_created');
}

/** Pure, deterministic transition function. Persistence supplies event-id idempotency. */
export function reduceLifecycle(previous: LifecycleState, event: LifecycleEvent, processedEventIds: ReadonlySet<string> = new Set()): LifecycleDecision {
  if (processedEventIds.has(event.id)) return { state: previous, tasksToCreate: [], eventsToEmit: [], duplicate: true };
  const state: LifecycleState = structuredClone(previous);
  const created: LifecycleTask[] = [];
  const emitted: string[] = [];
  const audit = (decision: string) => state.audit.push({ eventId: event.id, decision });

  switch (event.type) {
    case 'booking.received': complete(state, 'booking_received'); emitted.push('guest.contact_requested'); audit('booking accepted; guest contact requested'); break;
    case 'guest.contacted': complete(state, 'guest_contacted'); emitted.push('guest.data_requested'); audit('guest data request prepared'); break;
    case 'guest.data_requested': complete(state, 'guest_data_requested'); audit('waiting for guest data'); break;
    case 'guest.data_submitted': complete(state, 'guest_data_completed'); emitted.push('guest.documents_requested'); audit('guest data gate completed'); break;
    case 'guest.documents_uploaded': case 'guest.documents_received': complete(state, 'documents_received'); emitted.push('documents.verification_requested'); audit('documents await verification'); break;
    case 'guest.documents_verified': case 'documents.verified': complete(state, 'documents_verified'); emitted.push('contract.generation_requested'); audit('documents gate completed'); ensureTurnover(state, event.bookingId, created, emitted); break;
    case 'contract.generated': complete(state, 'contract_generated'); emitted.push('deposit.requested'); audit('contract generated'); ensureTurnover(state, event.bookingId, created, emitted); break;
    case 'deposit.requested': complete(state, 'deposit_requested'); audit('deposit requested'); break;
    case 'deposit.confirmed': complete(state, 'deposit_confirmed'); audit('deposit gate completed'); ensureTurnover(state, event.bookingId, created, emitted); break;
    case 'deposit.failed': state.blockers = [...new Set([...state.blockers, 'deposit_failed'])]; audit('deposit failed; dependent gates remain blocked'); break;
    case 'deposit.returned': if (state.completed.includes('checkout_inspected')) complete(state, 'deposit_returned'); audit('deposit returned'); break;
    case 'mvd.completed': case 'mvd.not_required':
      complete(state, 'mvd_completed');
      ensureTurnover(state, event.bookingId, created, emitted); audit('MVD gate completed'); break;
    case 'cleaner.task_completed': finishTask(state, 'cleaner'); complete(state, 'cleaning_completed'); audit('cleaning completed'); break;
    case 'linen.task_completed': finishTask(state, 'linen_worker'); complete(state, 'linen_completed'); audit('linen completed'); break;
    case 'consumables.task_completed': finishTask(state, 'consumables'); complete(state, 'consumables_completed'); audit('consumables completed'); break;
    case 'inspection.completed': finishTask(state, 'inspector'); state.inspectionRequired = false; complete(state, 'inspection_completed'); audit('inspection completed'); break;
    case 'damage.reported':
      state.maintenanceRequired = true; state.inspectionRequired = true; ensureTask(state, 'maintenance_technician', event.bookingId, created);
      emitted.push('maintenance.task_created'); audit('damage blocks readiness; maintenance created'); break;
    case 'maintenance.task_completed': {
      finishTask(state, 'maintenance_technician'); state.inspectionRequired = true;
      const reinspection = task('inspector', `${event.bookingId}:reinspection:${event.id}`);
      state.tasks.push(reinspection); created.push(reinspection);
      complete(state, 'maintenance_completed'); emitted.push('inspection.reinspection_requested'); audit('maintenance completed; returned to inspection'); break;
    }
    case 'property.ready': case 'property.readiness_changed': if (event.type === 'property.ready' || event.payload.ready === true) { recompute(state); if (state.readiness === 'ready') { complete(state, 'property_ready'); emitted.push('checkin.instructions_requested'); } } audit('readiness recalculated'); break;
    case 'checkin.instructions_released': recompute(state); if (state.readiness === 'ready') complete(state, 'checkin_released'); else audit('release rejected by blocking gate'); break;
    case 'guest.checked_in': if (state.completed.includes('checkin_released')) complete(state, 'checked_in'); audit('check-in recorded'); break;
    case 'stay.started': complete(state, 'in_stay'); audit('in-stay started'); break;
    case 'checkout.started': complete(state, 'checkout_started'); ensureTask(state, 'inspector', `${event.bookingId}:checkout`, created); audit('checkout inspection created'); break;
    case 'checkout.inspection_completed': complete(state, 'checkout_inspected'); emitted.push('deposit.return_requested'); audit('checkout inspection completed'); break;
    case 'deposit.return_completed': if (state.completed.includes('checkout_inspected')) { complete(state, 'deposit_returned'); emitted.push('booking.close_requested'); } audit('deposit returned'); break;
    case 'booking.closed': if (state.completed.includes('checkout_inspected') && state.completed.includes('deposit_returned')) complete(state, 'closed'); audit('booking closure evaluated'); break;
    case 'alert.acknowledged': audit('alert acknowledged; lifecycle unchanged'); break;
    case 'manual.override': audit(`manual override recorded: ${String(event.payload.reason ?? 'no reason')}`); break;
    default: audit(`event observed without transition: ${event.type}`);
  }
  recompute(state);
  if (state.readiness === 'ready' && !state.completed.includes('property_ready')) emitted.push('property.ready');
  return { state, tasksToCreate: created, eventsToEmit: [...new Set(emitted)], duplicate: false };
}
