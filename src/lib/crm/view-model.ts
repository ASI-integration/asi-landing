import { CRM_EVENT_TYPE_LABELS, CRM_ROLE_LABELS, CRM_SOURCE_LABELS, CRM_STATUS_LABELS } from './labels';
import {
  computeGuestTestSummary,
  countActiveUnresolvedEscalations,
  collectLatestIntentStates,
  deriveGuestTestListStatus,
  extractGuestTestQuestions,
  GUEST_TEST_LIST_STATUS_LABELS,
  hasActiveGuestTestOperatorFollowup,
} from './guest-test-result-loop';
import { computePilotOnboardingProgress } from './pilot-onboarding';
import {
  deriveCrmAutomationSuggestion,
  missingDataActionsForFields,
  type CrmPropertyAutomationSummary,
} from './automation-loop';
import type {
  CrmContactRow,
  CrmContactViewModel,
  CrmEventRow,
  CrmEventType,
  CrmEventViewModel,
  CrmFilter,
  CrmPilotApplicationSummary,
  CrmRole,
  CrmSource,
  CrmStatus,
} from './types';
import { CRM_EVENT_TYPES, CRM_ROLES, CRM_SOURCES, CRM_STATUSES } from './types';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseRole(value: string): CrmRole {
  return (CRM_ROLES as readonly string[]).includes(value) ? (value as CrmRole) : 'unknown';
}

function parseSource(value: string): CrmSource {
  return (CRM_SOURCES as readonly string[]).includes(value) ? (value as CrmSource) : 'manual';
}

function parseStatus(value: string): CrmStatus {
  return (CRM_STATUSES as readonly string[]).includes(value) ? (value as CrmStatus) : 'new';
}

function parseEventType(value: string): CrmEventType {
  return (CRM_EVENT_TYPES as readonly string[]).includes(value) ? (value as CrmEventType) : 'note';
}

function formatTelegramDisplay(username: string | null, userId: string | null, chatId: string | null): string | null {
  const cleanUsername = username?.replace(/^@+/, '') || null;
  if (cleanUsername) return `@${cleanUsername}`;
  if (userId) return `id ${userId.slice(0, 8)}…`;
  if (chatId) return `чат ${chatId.slice(0, 8)}…`;
  return null;
}

function hasGuestTestActivity(events: CrmEventRow[]): boolean {
  return events.some(
    (event) => event.event_type === 'guest_test_started' || event.event_type === 'guest_test_question',
  );
}

function collectMissingDataFields(events: CrmEventRow[], propertyId?: string | null): string[] {
  if (hasGuestTestActivity(events)) {
    return computeGuestTestSummary(events, propertyId).missingFields;
  }

  const fields = new Set<string>();
  for (const event of events) {
    if (event.event_type !== 'missing_data' && event.event_type !== 'guest_test_missing_data') continue;
    if (event.acknowledged_at) continue;
    const meta = asRecord(event.metadata);
    const missing = meta.missing_fields;
    if (Array.isArray(missing)) {
      for (const field of missing) {
        const text = asString(field);
        if (text) fields.add(text);
      }
    }
  }
  return [...fields];
}

export function computeNeedsReaction(input: {
  status: CrmStatus;
  awaitingReply: boolean;
  nextAction: string;
  nextActionDueAt: string | null;
  events: CrmEventRow[];
  propertyId?: string | null;
}): { needsReaction: boolean; reasons: string[]; escalationCount: number; unresolvedEscalationCount: number } {
  const reasons: string[] = [];
  let escalationCount = 0;
  const guestTestActive = hasGuestTestActivity(input.events);
  const latestIntentStates = guestTestActive ? collectLatestIntentStates(input.events) : null;
  const activeMissingFields = guestTestActive
    ? computeGuestTestSummary(input.events, input.propertyId).missingFields
    : collectMissingDataFields(input.events, input.propertyId);

  for (const event of input.events) {
    if (
      event.event_type === 'escalation' ||
      event.event_type === 'missing_data' ||
      event.event_type === 'guest_test_missing_data' ||
      event.event_type === 'operator_followup_required'
    ) {
      escalationCount += 1;
    }
  }

  const unresolvedEscalationCount = guestTestActive && latestIntentStates
    ? countActiveUnresolvedEscalations(input.events, latestIntentStates, activeMissingFields)
    : input.events.filter(
        (event) =>
          (event.event_type === 'escalation' ||
            event.event_type === 'missing_data' ||
            event.event_type === 'guest_test_missing_data' ||
            event.event_type === 'operator_followup_required') &&
          !event.acknowledged_at,
      ).length;

  if (unresolvedEscalationCount > 0) {
    reasons.push('Есть неразобранная эскалация');
  }

  if (activeMissingFields.length > 0) {
    reasons.push('Не хватает данных объекта');
  }

  const hasOpenOperatorFollowup = guestTestActive
    ? hasActiveGuestTestOperatorFollowup(input.events)
    : input.events.some(
        (event) => event.event_type === 'operator_followup_required' && !event.acknowledged_at,
      );

  if (input.awaitingReply && (!guestTestActive || hasOpenOperatorFollowup)) {
    reasons.push('Пользователь ждёт ответа');
  }

  const nextActionEmpty = !input.nextAction.trim();
  const nextActionOverdue = input.nextActionDueAt
    ? new Date(input.nextActionDueAt).getTime() < Date.now()
    : false;

  if (nextActionEmpty && input.status !== 'not_fit' && input.status !== 'paused') {
    reasons.push('Не задан следующий шаг');
  } else if (nextActionOverdue) {
    reasons.push('Следующий шаг просрочен');
  }

  return {
    needsReaction: reasons.length > 0,
    reasons,
    escalationCount,
    unresolvedEscalationCount,
  };
}

export function normalizeCrmEventRow(row: CrmEventRow): CrmEventViewModel {
  const eventType = parseEventType(row.event_type);
  const metadata = asRecord(row.metadata);
  const priority = eventType === 'escalation' ? asString(metadata.priority ?? metadata.severity) : '';
  return {
    id: row.id,
    eventType,
    messageText: row.message_text,
    propertyId: row.property_id,
    metadata,
    acknowledgedAt: row.acknowledged_at,
    createdAt: row.created_at,
    label: priority ? `${CRM_EVENT_TYPE_LABELS[eventType]}: ${priority}` : CRM_EVENT_TYPE_LABELS[eventType],
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => asString(item)).filter(Boolean)
    : [];
}

function latestPilotApplication(events: CrmEventRow[]): CrmPilotApplicationSummary | null {
  const event = events.find((item) => item.event_type === 'pilot_application_submitted');
  if (!event) return null;
  const meta = asRecord(event.metadata);
  const propertyCountRaw = Number(meta.property_count);
  return {
    city: asString(meta.city),
    propertyCount: Number.isFinite(propertyCountRaw) ? propertyCountRaw : null,
    channelManager: asString(meta.channel_manager_label ?? meta.channel_manager),
    platforms: asStringArray(meta.platform_labels ?? meta.platforms),
    hasActiveBookings: asString(meta.has_active_bookings_label ?? meta.has_active_bookings),
    testFocus: asString(meta.test_focus_label ?? meta.test_focus),
    feedbackReady: asString(meta.feedback_ready_label ?? meta.feedback_ready),
    roleAnswer: asString(meta.role_label ?? meta.role_answer),
    telegramContact: asString(meta.telegram_contact) || null,
    suggestedNextAction: asString(meta.suggested_next_action),
    submittedAt: event.created_at,
  };
}

export function normalizeCrmContactRow(
  row: CrmContactRow,
  events: CrmEventRow[] = [],
  propertySummary: CrmPropertyAutomationSummary | null = null,
): CrmContactViewModel {
  const role = parseRole(row.role);
  const source = parseSource(row.source);
  const status = parseStatus(row.status);
  const normalizedEvents = events.map(normalizeCrmEventRow);
  const telegramDisplay = formatTelegramDisplay(row.telegram_username, row.telegram_user_id, row.telegram_chat_id);
  const pilotApplication = latestPilotApplication(events);
  const missingDataFields = collectMissingDataFields(events, row.property_id);
  const guestTestResults = extractGuestTestQuestions(events);
  const guestTestSummary = guestTestResults.length > 0 || events.some((e) => e.event_type === 'guest_test_started')
    ? computeGuestTestSummary(events, row.property_id)
    : null;
  const missingDataActions = guestTestSummary
    ? guestTestSummary.missingDataActions
    : missingDataActionsForFields(missingDataFields, row.property_id);
  const guestTestListStatus = guestTestSummary
    ? deriveGuestTestListStatus(events, guestTestSummary)
    : 'not_started';
  const guestTestListStatusLabel = GUEST_TEST_LIST_STATUS_LABELS[guestTestListStatus];
  const hasOperatorFollowupPending = events.some(
    (event) => event.event_type === 'operator_followup_required' && !event.acknowledged_at,
  );
  const reaction = computeNeedsReaction({
    status,
    awaitingReply: row.awaiting_reply,
    nextAction: row.next_action,
    nextActionDueAt: row.next_action_due_at,
    events,
    propertyId: row.property_id,
  });
  const automation = deriveCrmAutomationSuggestion({
    role,
    status,
    source,
    contact: row.contact,
    telegramDisplay,
    propertyId: row.property_id,
    explicitNextAction: row.next_action,
    propertySummary,
    missingDataActions,
    hasOpenReaction: reaction.unresolvedEscalationCount > 0,
  });
  const pilotOnboardingProgress = computePilotOnboardingProgress({
    source,
    status,
    propertyId: row.property_id,
    pilotApplication,
    propertySummary,
    recentEvents: normalizedEvents,
  });

  return {
    id: row.id,
    name: row.name || 'Без имени',
    role,
    roleLabel: CRM_ROLE_LABELS[role],
    source,
    sourceLabel: CRM_SOURCE_LABELS[source],
    contact: row.contact,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username?.replace(/^@+/, '') || null,
    telegramChatId: row.telegram_chat_id,
    telegramDisplay,
    status,
    statusLabel: CRM_STATUS_LABELS[status],
    effectiveStatus: automation.effectiveStatus,
    effectiveStatusLabel: CRM_STATUS_LABELS[automation.effectiveStatus],
    propertyId: row.property_id,
    propertySummary,
    propertyCount: row.property_count,
    pilotApplication,
    pilotOnboardingProgress,
    notes: row.notes,
    nextAction: automation.suggestedNextAction,
    nextActionIsSuggested: automation.nextActionIsSuggested,
    nextActionHref: automation.nextActionHref,
    nextActionDueAt: row.next_action_due_at,
    lastMessage: row.last_message,
    lastActivityAt: row.last_activity_at ?? row.updated_at,
    leadId: row.lead_id,
    awaitingReply: row.awaiting_reply,
    escalationCount: reaction.escalationCount,
    unresolvedEscalationCount: reaction.unresolvedEscalationCount,
    needsReaction: reaction.needsReaction,
    needsReactionReasons: reaction.reasons,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recentEvents: normalizedEvents.slice(0, 20),
    missingDataFields,
    missingDataActions,
    guestTestResults,
    guestTestSummary,
    guestTestListStatus,
    guestTestListStatusLabel,
    hasOperatorFollowupPending,
  };
}

export function matchesCrmFilter(contact: CrmContactViewModel, filter: CrmFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'new':
      return contact.effectiveStatus === 'new';
    case 'needs_reaction':
      return contact.needsReaction;
    case 'pilot_candidates':
      return (
        contact.status === 'pilot_candidate' ||
        contact.status === 'pilot_selected' ||
        contact.status === 'pilot_waitlist' ||
        contact.source === 'pilot_form'
      );
    case 'pilot_selected':
      return (
        contact.status === 'pilot_selected' ||
        contact.recentEvents.some((event) => event.eventType === 'pilot_selected')
      );
    case 'testing':
      return contact.effectiveStatus === 'testing_communication' || contact.source === 'test';
    case 'pilot_active':
      return contact.effectiveStatus === 'pilot_active';
    case 'escalations':
      return contact.unresolvedEscalationCount > 0;
    default:
      return true;
  }
}

export function isCrmRole(value: string): value is CrmRole {
  return (CRM_ROLES as readonly string[]).includes(value);
}

export function isCrmSource(value: string): value is CrmSource {
  return (CRM_SOURCES as readonly string[]).includes(value);
}

export function isCrmStatus(value: string): value is CrmStatus {
  return (CRM_STATUSES as readonly string[]).includes(value);
}
