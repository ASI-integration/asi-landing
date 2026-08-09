import {
  executeGuestLifecycleEvent,
  guestLifecycleStage,
  type GuestLifecycleContextResolution,
  type GuestLifecycleDeliveryResult,
  type GuestLifecycleEvent,
  type GuestLifecycleExecutionPort,
  type GuestLifecycleExecutionRecord,
  type GuestLifecyclePlan,
  type GuestLifecycleReservationContext,
} from './guest-lifecycle';

export const SYNTHETIC_GUEST_LIFECYCLE_SEQUENCE = [
  'reservation.created',
  'reservation.confirmed',
  'arrival.due_24h',
  'checkin.ready',
  'guest.checked_in',
  'stay.checkin_followup',
  'checkout.due_24h',
  'guest.checked_out',
  'stay.completed',
] as const;

export type SyntheticGuestLifecycleState = {
  records: Map<string, GuestLifecycleExecutionRecord>;
  textDeliveries: Array<{ key: string; text: string; language: 'ru' | 'en' }>;
  voiceAttempts: Array<{ key: string; sent: boolean }>;
  operatorRequests: Array<{ key: string; reason: string; urgent: boolean }>;
  memoryEvents: Array<{ key: string; type: string; summary: string }>;
};

export type SyntheticGuestLifecycleHarness = {
  port: GuestLifecycleExecutionPort;
  state: SyntheticGuestLifecycleState;
  context: GuestLifecycleReservationContext;
  setResolution(value: GuestLifecycleContextResolution): void;
  setVoiceFailure(value: boolean): void;
  setTextFailure(value: boolean): void;
};

function cloneRecord(record: GuestLifecycleExecutionRecord): GuestLifecycleExecutionRecord {
  return { ...record, event: { ...record.event, facts: record.event.facts ? { ...record.event.facts } : undefined } };
}
export function syntheticLifecycleContext(overrides: Partial<GuestLifecycleReservationContext> = {}): GuestLifecycleReservationContext {
  return {
    bookingOpsRecordId: '11111111-1111-4111-8111-111111111111',
    reservationId: 'synthetic-reservation-1',
    propertyId: 'synthetic-property-1',
    guestId: 'synthetic-guest-1',
    guestName: 'Synthetic Guest',
    channel: 'telegram',
    targetId: '900001',
    checkInAt: '2026-08-12T12:00:00.000Z',
    checkOutAt: '2026-08-15T09:00:00.000Z',
    propertyLabel: 'Synthetic Apartment',
    propertyKnowledge: {
      propertyId: 'synthetic-property-1',
      propertyLabel: 'Synthetic Apartment',
      address: 'Test Street 1',
      entranceInstructions: 'Use the verified main entrance',
      floorApartment: '2',
      intercomCode: null,
      keyPickupInstructions: 'Keys are in the verified reception envelope',
      wifiName: 'SyntheticWiFi',
      wifiPassword: 'synthetic-only',
      parkingInstructions: 'Use the marked synthetic space',
      houseRules: 'Quiet hours start at 22:00',
      quietHours: '22:00-08:00',
      checkoutInstructions: 'Leave the keys at reception',
      emergencyInstructions: 'Contact the operator',
      cleaningLinenNotes: null,
      publicGuestNotes: null,
      privateOperatorNotes: null,
      updatedAt: '2026-08-09T00:00:00.000Z',
    },
    guestMemory: {
      preferredLanguage: 'ru',
      preferredCommunicationMode: 'text',
      returningGuest: false,
      stayCount: 0,
      lastStayAt: null,
      preferences: [],
      events: [],
    },
    identityVerified: true,
    accessAllowed: true,
    reservationCancelled: false,
    operatorHandoffActive: false,
    ...overrides,
  };
}

export function createSyntheticGuestLifecycleHarness(options: {
  state?: SyntheticGuestLifecycleState;
  context?: GuestLifecycleReservationContext;
} = {}): SyntheticGuestLifecycleHarness {
  const state: SyntheticGuestLifecycleState = options.state ?? {
    records: new Map(),
    textDeliveries: [],
    voiceAttempts: [],
    operatorRequests: [],
    memoryEvents: [],
  };
  const context = options.context ?? syntheticLifecycleContext();
  let resolution: GuestLifecycleContextResolution = { ok: true, context };
  let voiceFailure = false;
  let textFailure = false;

  const port: GuestLifecycleExecutionPort = {
    async findByIdempotencyKey(key) {
      const record = state.records.get(key);
      return record ? cloneRecord(record) : null;
    },
    async claim(event, key, stage) {
      const existing = state.records.get(key);
      if (existing) return cloneRecord(existing);
      const record: GuestLifecycleExecutionRecord = {
        id: `synthetic-event-${state.records.size + 1}`,
        idempotencyKey: key,
        event,
        stage,
        status: 'received',
        operatorActionRequired: false,
        updatedAt: event.occurredAt,
      };
      state.records.set(key, record);
      return cloneRecord(record);
    },
    async update(id, patch) {
      const current = [...state.records.values()].find((record) => record.id === id);
      if (!current) throw new Error('synthetic_record_not_found');
      const updated = { ...current, ...patch };
      state.records.set(updated.idempotencyKey, updated);
      return cloneRecord(updated);
    },
    async resolveContext() {
      return resolution;
    },
    async deliver({ plan, idempotencyKey }): Promise<GuestLifecycleDeliveryResult> {
      if (textFailure) return { status: 'failed', reason: 'synthetic_text_failure' };
      if (!state.textDeliveries.some((delivery) => delivery.key === idempotencyKey)) {
        state.textDeliveries.push({ key: idempotencyKey, text: plan.text ?? '', language: plan.language });
      }
      if (plan.communicationMode === 'voice') {
        state.voiceAttempts.push({ key: idempotencyKey, sent: !voiceFailure });
      }
      return {
        status: 'sent',
        communicationIntentId: `synthetic-intent-${idempotencyKey.slice(-8)}`,
        deliveryId: `synthetic-delivery-${idempotencyKey.slice(-8)}`,
        deliveryStatus: 'sent',
      };
    },
    async requestOperator({ plan, idempotencyKey }) {
      if (!state.operatorRequests.some((request) => request.key === idempotencyKey)) {
        state.operatorRequests.push({
          key: idempotencyKey,
          reason: plan.operatorReason ?? 'operator_required',
          urgent: plan.urgent,
        });
      }
      return { reviewId: `synthetic-review-${idempotencyKey.slice(-8)}` };
    },
    async recordMemory({ plan, idempotencyKey }) {
      if (!plan.memoryEvent || state.memoryEvents.some((event) => event.key === idempotencyKey)) return;
      state.memoryEvents.push({
        key: idempotencyKey,
        type: plan.memoryEvent,
        summary: plan.memoryEvent === 'completed_stay' ? 'Completed stay.' : 'Verified structured lifecycle history.',
      });
    },
  };

  return {
    port,
    state,
    context,
    setResolution(value) { resolution = value; },
    setVoiceFailure(value) { voiceFailure = value; },
    setTextFailure(value) { textFailure = value; },
  };
}

export function syntheticGuestLifecycleEvent(
  eventType: GuestLifecycleEvent['eventType'],
  overrides: Partial<GuestLifecycleEvent> = {},
): GuestLifecycleEvent {
  return {
    eventType,
    reservationId: 'synthetic-reservation-1',
    propertyId: 'synthetic-property-1',
    guestId: 'synthetic-guest-1',
    occurredAt: '2026-08-09T12:00:00.000Z',
    source: 'synthetic_acceptance',
    sourceEventId: `synthetic-${eventType}`,
    ...overrides,
  };
}

export async function runSyntheticGuestLifecycleAcceptance(input: {
  language?: 'ru' | 'en';
  communicationMode?: 'text' | 'voice';
} = {}) {
  const context = syntheticLifecycleContext({
    guestMemory: {
      preferredLanguage: input.language ?? 'ru',
      preferredCommunicationMode: input.communicationMode ?? 'text',
      returningGuest: false,
      stayCount: 0,
      lastStayAt: null,
      preferences: [],
      events: [],
    },
  });
  const harness = createSyntheticGuestLifecycleHarness({ context });
  const results = [];
  for (const [index, eventType] of SYNTHETIC_GUEST_LIFECYCLE_SEQUENCE.entries()) {
    const event = syntheticGuestLifecycleEvent(eventType, {
      occurredAt: new Date(Date.parse('2026-08-09T12:00:00.000Z') + index * 60_000).toISOString(),
      facts: eventType === 'stay.completed' ? { feedbackAppropriate: true } : undefined,
    });
    results.push(await executeGuestLifecycleEvent(event, harness.port, { now: new Date(event.occurredAt) }));
  }
  return {
    ok: results.every((result) => result.ok),
    noExternalActions: true,
    reservationId: context.reservationId,
    sequence: [...SYNTHETIC_GUEST_LIFECYCLE_SEQUENCE],
    stages: results.map((result) => guestLifecycleStage(result.record.event.eventType)),
    results,
    textDeliveries: harness.state.textDeliveries,
    voiceAttempts: harness.state.voiceAttempts,
    operatorRequests: harness.state.operatorRequests,
    memoryEvents: harness.state.memoryEvents,
  };
}
