import { missingDataActionsForFields, type CrmMissingDataAction } from './automation-loop';
import { recordCrmCommunicationEvent, updateCrmContact } from './repository';
import type {
  CrmEventRow,
  GuestTestCategoryState,
  GuestTestCheckStatus,
  GuestTestListStatus,
  GuestTestQuestionCategory,
  GuestTestQuestionOutcome,
  GuestTestSummary,
} from './types';

export type {
  GuestTestCategoryState,
  GuestTestCheckStatus,
  GuestTestListStatus,
  GuestTestQuestionCategory,
  GuestTestSummary,
} from './types';

export const GUEST_TEST_LIST_STATUS_LABELS: Record<GuestTestListStatus, string> = {
  not_started: '',
  started: 'Тест гостя начат',
  partial_pass: 'Тест гостя частично пройден',
  passed: 'Тест гостя пройден',
  needs_data: 'Нужны данные',
  needs_reaction: 'Нужна реакция',
};

export const GUEST_TEST_CHECK_STATUS_LABELS: Record<GuestTestCheckStatus | 'verified_global_rule', string> = {
  verified: 'проверен',
  not_verified: 'не проверен',
  no_data: 'нет данных',
  verified_global_rule: 'проверено глобальным правилом',
};

const TRACKED_CATEGORIES: GuestTestQuestionCategory[] = ['address', 'wifi', 'smoking', 'checkin', 'rules'];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeGuestTestIntent(intent: string): GuestTestQuestionCategory {
  const normalized = intent.trim().toLowerCase();
  if (normalized === 'house_rules') return 'rules';
  if (TRACKED_CATEGORIES.includes(normalized as GuestTestQuestionCategory)) {
    return normalized as GuestTestQuestionCategory;
  }
  return 'unknown';
}

type LatestIntentState = {
  outcome: GuestTestQuestionOutcome;
  missingFields: string[];
  createdAt: string;
};

const DEFAULT_MISSING_FIELDS: Record<Exclude<GuestTestQuestionCategory, 'unknown' | 'smoking'>, string[]> = {
  address: ['object.address', 'object.directionsText'],
  wifi: ['object.wifiName', 'object.wifiPassword'],
  checkin: ['object.check_in_text', 'booking.checkoutTime'],
  rules: ['object.houseRules'],
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => asString(item)).filter(Boolean)
    : [];
}

function sortEventsChronologically(events: CrmEventRow[]): CrmEventRow[] {
  return [...events].sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export function collectLatestIntentStates(events: CrmEventRow[]): Map<GuestTestQuestionCategory, LatestIntentState> {
  const latest = new Map<GuestTestQuestionCategory, LatestIntentState>();

  for (const event of sortEventsChronologically(events)) {
    if (event.event_type !== 'guest_test_question') continue;
    const meta = asRecord(event.metadata);
    const intent = normalizeGuestTestIntent(asString(meta.intent));
    if (intent === 'unknown') continue;
    const outcome = asString(meta.outcome) as GuestTestQuestionOutcome;
    if (!outcome) continue;

    latest.set(intent, {
      outcome,
      missingFields: asStringArray(meta.missing_fields),
      createdAt: event.created_at,
    });
  }

  return latest;
}

function isSuccessfulOutcome(outcome: GuestTestQuestionOutcome): boolean {
  return outcome === 'answered_from_property_data' || outcome === 'answered_from_global_rule';
}

function deriveActiveMissingFields(
  latestIntentStates: Map<GuestTestQuestionCategory, LatestIntentState>,
): string[] {
  const fields = new Set<string>();

  for (const category of ['address', 'wifi', 'checkin', 'rules'] as const) {
    const state = latestIntentStates.get(category);
    if (!state || state.outcome !== 'missing_data') continue;
    const missing = state.missingFields.length > 0 ? state.missingFields : DEFAULT_MISSING_FIELDS[category];
    for (const field of missing) fields.add(field);
  }

  return [...fields];
}

function isMissingDataEventStale(
  event: CrmEventRow,
  latestIntentStates: Map<GuestTestQuestionCategory, LatestIntentState>,
  activeMissingFields: string[],
): boolean {
  if (event.acknowledged_at) return true;

  const meta = asRecord(event.metadata);
  const intent = normalizeGuestTestIntent(asString(meta.intent));
  if (intent !== 'unknown') {
    const latest = latestIntentStates.get(intent);
    if (latest && isSuccessfulOutcome(latest.outcome)) return true;
    if (intent === 'smoking') return true;
  }

  const eventFields = asStringArray(meta.missing_fields);
  if (eventFields.length === 0) return false;
  return eventFields.every((field) => !activeMissingFields.includes(field));
}

function isOperatorFollowupSuperseded(
  event: CrmEventRow,
  latestIntentStates: Map<GuestTestQuestionCategory, LatestIntentState>,
): boolean {
  const meta = asRecord(event.metadata);
  const intent = normalizeGuestTestIntent(asString(meta.intent));
  if (intent === 'unknown') return false;
  const latest = latestIntentStates.get(intent);
  return Boolean(latest && isSuccessfulOutcome(latest.outcome) && latest.createdAt >= event.created_at);
}

export function countActiveUnresolvedEscalations(
  events: CrmEventRow[],
  latestIntentStates: Map<GuestTestQuestionCategory, LatestIntentState>,
  activeMissingFields: string[],
): number {
  let count = 0;

  for (const event of events) {
    if (event.acknowledged_at) continue;
    if (event.event_type === 'escalation') {
      count += 1;
      continue;
    }
    if (event.event_type === 'operator_followup_required') {
      if (!isOperatorFollowupSuperseded(event, latestIntentStates)) count += 1;
      continue;
    }
    if (event.event_type === 'missing_data' || event.event_type === 'guest_test_missing_data') {
      if (!isMissingDataEventStale(event, latestIntentStates, activeMissingFields)) count += 1;
    }
  }

  return count;
}

function categoryStateFromOutcome(
  category: GuestTestQuestionCategory,
  outcome: GuestTestQuestionOutcome,
): GuestTestCategoryState {
  if (category === 'smoking') {
    if (outcome === 'answered_from_global_rule' || outcome === 'answered_from_property_data') {
      return { status: 'verified_global_rule', label: GUEST_TEST_CHECK_STATUS_LABELS.verified_global_rule };
    }
    if (outcome === 'missing_data') {
      return { status: 'no_data', label: GUEST_TEST_CHECK_STATUS_LABELS.no_data };
    }
    if (outcome === 'operator_followup_required') {
      return { status: 'not_verified', label: GUEST_TEST_CHECK_STATUS_LABELS.not_verified };
    }
    return { status: 'not_verified', label: GUEST_TEST_CHECK_STATUS_LABELS.not_verified };
  }

  if (outcome === 'answered_from_property_data' || outcome === 'answered_from_global_rule') {
    return { status: 'verified', label: GUEST_TEST_CHECK_STATUS_LABELS.verified };
  }
  if (outcome === 'missing_data') {
    return { status: 'no_data', label: GUEST_TEST_CHECK_STATUS_LABELS.no_data };
  }
  if (outcome === 'operator_followup_required') {
    return { status: 'not_verified', label: GUEST_TEST_CHECK_STATUS_LABELS.not_verified };
  }
  return { status: 'not_verified', label: GUEST_TEST_CHECK_STATUS_LABELS.not_verified };
}

function defaultCategoryState(category: GuestTestQuestionCategory): GuestTestCategoryState {
  if (category === 'smoking') {
    return { status: 'not_verified', label: GUEST_TEST_CHECK_STATUS_LABELS.not_verified };
  }
  return { status: 'not_verified', label: GUEST_TEST_CHECK_STATUS_LABELS.not_verified };
}

function hasUnacknowledgedOperatorFollowup(
  events: CrmEventRow[],
  latestIntentStates: Map<GuestTestQuestionCategory, LatestIntentState>,
): boolean {
  return events.some(
    (event) =>
      event.event_type === 'operator_followup_required' &&
      !event.acknowledged_at &&
      !isOperatorFollowupSuperseded(event, latestIntentStates),
  );
}

export function hasActiveGuestTestOperatorFollowup(events: CrmEventRow[]): boolean {
  return hasUnacknowledgedOperatorFollowup(events, collectLatestIntentStates(events));
}

function hasGuestTestStarted(events: CrmEventRow[]): boolean {
  return events.some((event) => event.event_type === 'guest_test_started');
}

function hasGuestTestPassedBasic(events: CrmEventRow[]): boolean {
  return events.some((event) => event.event_type === 'guest_test_passed_basic');
}

function isVerified(state: GuestTestCategoryState): boolean {
  return state.status === 'verified' || state.status === 'verified_global_rule';
}

export function computeGuestTestSummary(
  events: CrmEventRow[],
  propertyId?: string | null,
): GuestTestSummary {
  const latestIntentStates = collectLatestIntentStates(events);

  const address = latestIntentStates.has('address')
    ? categoryStateFromOutcome('address', latestIntentStates.get('address')!.outcome)
    : defaultCategoryState('address');
  const wifi = latestIntentStates.has('wifi')
    ? categoryStateFromOutcome('wifi', latestIntentStates.get('wifi')!.outcome)
    : defaultCategoryState('wifi');
  const checkin = latestIntentStates.has('checkin')
    ? categoryStateFromOutcome('checkin', latestIntentStates.get('checkin')!.outcome)
    : defaultCategoryState('checkin');
  const rules = latestIntentStates.has('rules')
    ? categoryStateFromOutcome('rules', latestIntentStates.get('rules')!.outcome)
    : defaultCategoryState('rules');
  const smoking = latestIntentStates.has('smoking')
    ? categoryStateFromOutcome('smoking', latestIntentStates.get('smoking')!.outcome)
    : defaultCategoryState('smoking');

  const missingFields = deriveActiveMissingFields(latestIntentStates);
  const missingDataActions = missingDataActionsForFields(missingFields, propertyId);
  const basicPassed = isVerified(address) && isVerified(wifi) && isVerified(smoking);
  const fullyPassed = basicPassed && isVerified(checkin) && isVerified(rules);

  let nextAction = '';
  if (hasUnacknowledgedOperatorFollowup(events, latestIntentStates)) {
    nextAction = 'Ответить гостю';
  } else if (missingDataActions.length > 0) {
    nextAction = `Заполнить: ${missingDataActions[0].label}`;
  } else if (fullyPassed) {
    nextAction = 'Готовить объект к пилоту';
  } else if (basicPassed) {
    nextAction = 'Проверить заезд и правила';
  } else if (hasGuestTestStarted(events)) {
    nextAction = 'Продолжить тест гостя';
  }

  return {
    address,
    wifi,
    checkin,
    rules,
    smoking,
    hasStarted: hasGuestTestStarted(events),
    basicPassed,
    fullyPassed,
    missingFields,
    missingDataActions,
    nextAction,
  };
}

export function deriveGuestTestListStatus(
  events: CrmEventRow[],
  summary: GuestTestSummary,
): GuestTestListStatus {
  const latestIntentStates = collectLatestIntentStates(events);
  if (hasUnacknowledgedOperatorFollowup(events, latestIntentStates)) return 'needs_reaction';
  if (summary.missingDataActions.length > 0) return 'needs_data';
  if (summary.fullyPassed) return 'passed';
  if (summary.basicPassed || summary.hasStarted) {
    const anyVerified =
      isVerified(summary.address) ||
      isVerified(summary.wifi) ||
      isVerified(summary.smoking) ||
      isVerified(summary.checkin) ||
      isVerified(summary.rules);
    if (summary.basicPassed && !summary.fullyPassed) return 'partial_pass';
    if (anyVerified) return 'partial_pass';
    if (summary.hasStarted) return 'started';
  }
  return 'not_started';
}

export function extractGuestTestQuestions(
  events: Array<{ event_type: string; message_text: string | null; metadata: Record<string, unknown> | null; created_at: string }>,
): Array<{ question: string; outcome: string; intent: string; createdAt: string }> {
  return events
    .filter((event) => event.event_type === 'guest_test_question')
    .slice(0, 8)
    .map((event) => {
      const meta = event.metadata ?? {};
      return {
        question: event.message_text ?? '',
        outcome: String(meta.outcome ?? 'unknown'),
        intent: String(meta.intent ?? ''),
        createdAt: event.created_at,
      };
    });
}

export async function reconcileGuestTestResultLoop(input: {
  telegramUserId: string;
  telegramChatId: number;
  propertyId?: string | null;
  contactId?: string | null;
}): Promise<void> {
  const { supabase } = await import('@/lib/supabase');

  let contactId = input.contactId?.trim() || null;
  if (!contactId) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('id')
      .eq('telegram_user_id', input.telegramUserId.trim())
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    contactId = (data as { id?: string } | null)?.id ?? null;
  }
  if (!contactId) return;

  const { data: eventRows, error } = await supabase
    .from('crm_events')
    .select('id, contact_id, event_type, message_text, property_id, metadata, acknowledged_at, created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) {
    console.error('[guest-test-result-loop] load events failed', { error: error.message });
    return;
  }

  const events = (eventRows ?? []) as CrmEventRow[];
  const summary = computeGuestTestSummary(events, input.propertyId);
  const listStatus = deriveGuestTestListStatus(events, summary);

  if (summary.basicPassed && !hasGuestTestPassedBasic(events)) {
    await recordCrmCommunicationEvent({
      contactId,
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
      eventType: 'guest_test_passed_basic',
      propertyId: input.propertyId ?? undefined,
      metadata: {
        address: summary.address.status,
        wifi: summary.wifi.status,
        smoking: summary.smoking.status,
        next_action: summary.fullyPassed ? 'Готовить объект к пилоту' : 'Проверить заезд и правила',
      },
    });
  }

  const contactPatch: {
    nextAction?: string;
    status?: 'needs_reaction' | 'testing_communication';
    awaitingReply?: boolean;
  } = {};

  if (listStatus === 'needs_reaction') {
    contactPatch.status = 'needs_reaction';
    contactPatch.awaitingReply = true;
    contactPatch.nextAction = 'Ответить гостю';
  } else if (summary.nextAction) {
    contactPatch.nextAction = summary.nextAction;
    contactPatch.awaitingReply = false;
    if (listStatus !== 'needs_data') {
      contactPatch.status = 'testing_communication';
    }
  }

  if (Object.keys(contactPatch).length > 0) {
    await updateCrmContact(contactId, contactPatch);
  }
}
