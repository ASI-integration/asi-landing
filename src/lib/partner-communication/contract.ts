import 'server-only';

export const PARTNER_COMMUNICATION_SCHEMA_VERSION = 'partner.communication.v1' as const;
export const PARTNER_COMMUNICATION_RESPONSE_SCHEMA_VERSION = 'partner.communication.response.v1' as const;
export const PARTNER_COMMUNICATION_EVENT_TYPE = 'guest.message.received' as const;

export const PARTNER_COMMUNICATION_ERROR_CODES = [
  'partner_contract_invalid',
  'partner_schema_version_unsupported',
  'partner_event_type_unsupported',
  'partner_identity_invalid',
  'partner_booking_state_invalid',
  'partner_message_invalid',
] as const;

export type PartnerCommunicationErrorCode = (typeof PARTNER_COMMUNICATION_ERROR_CODES)[number];
export type PartnerBookingStatus = 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
export type PartnerCommunicationDecisionType = 'reply' | 'recommendation' | 'clarify' | 'escalate' | 'no_action';
export type PartnerCommunicationPolicyDecision = 'auto_allowed' | 'review_required' | 'blocked';

export type PartnerGuestMessageEventV1 = {
  schemaVersion: typeof PARTNER_COMMUNICATION_SCHEMA_VERSION;
  eventId: string;
  eventType: typeof PARTNER_COMMUNICATION_EVENT_TYPE;
  occurredAt: string;
  partner: {
    partnerId: string;
    accountId: string;
  };
  property: {
    propertyId: string;
  };
  booking: {
    bookingId: string;
    status?: PartnerBookingStatus | null;
    checkInAt?: string | null;
    checkOutAt?: string | null;
  };
  guest: {
    guestId?: string | null;
    preferredLanguage?: 'ru' | null;
  };
  conversation: {
    conversationId: string;
    messageId: string;
    channel: 'partner_messaging';
    text: string;
  };
};

export type PartnerCommunicationIdentityKeys = {
  partnerAccountKey: string;
  partnerPropertyKey: string;
  partnerBookingKey: string;
  partnerGuestKey: string | null;
  partnerConversationKey: string;
  partnerMessageKey: string;
  partnerEventIdempotencyKey: string;
};

const TRUSTED_PARTNER_CONTEXT = Symbol('trusted-partner-communication-context');

/**
 * Authoritative partner context for server-side ASI layers.
 *
 * This branded type is constructed only by the server-only validator below.
 * Its caller must be a future authenticated server-to-server partner boundary,
 * or the explicitly synthetic fixture used by focused tests. Validation alone
 * does not authenticate a partner.
 */
export type PartnerCommunicationContext = {
  readonly [TRUSTED_PARTNER_CONTEXT]: true;
  readonly schemaVersion: typeof PARTNER_COMMUNICATION_SCHEMA_VERSION;
  readonly eventType: typeof PARTNER_COMMUNICATION_EVENT_TYPE;
  readonly occurredAt: string;
  readonly identity: {
    readonly partnerId: string;
    readonly accountId: string;
    readonly propertyId: string;
    readonly bookingId: string;
    readonly guestId: string | null;
    readonly conversationId: string;
    readonly messageId: string;
    readonly eventId: string;
  };
  readonly booking: {
    readonly status: PartnerBookingStatus | null;
    readonly checkInAt: string | null;
    readonly checkOutAt: string | null;
  };
  readonly guest: {
    readonly preferredLanguage: 'ru' | null;
  };
  readonly message: {
    readonly channel: 'partner_messaging';
    readonly text: string;
  };
  readonly keys: PartnerCommunicationIdentityKeys;
};

export type PartnerOperationalActionV1 = {
  actionId: string;
  type: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'recommended' | 'requested' | 'in_progress' | 'resolved' | 'blocked';
  reason: string;
};

export type PartnerCommunicationDecisionEnvelopeV1 = {
  schemaVersion: typeof PARTNER_COMMUNICATION_RESPONSE_SCHEMA_VERSION;
  accepted: boolean;
  duplicate: boolean;
  auditRef: string;
  identity: PartnerCommunicationContext['identity'];
  decision: {
    type: PartnerCommunicationDecisionType;
    text: string | null;
    confidence: number | null;
    policy: PartnerCommunicationPolicyDecision;
    reasonCodes: string[];
  };
  operationalActions: PartnerOperationalActionV1[];
  resultingState: {
    conversation: 'active' | 'awaiting_input' | 'escalated' | 'resolved';
    issue: 'none' | 'open' | 'blocked' | 'resolved';
    operatorRequired: boolean;
  };
};

export class PartnerCommunicationContractError extends Error {
  readonly code: PartnerCommunicationErrorCode;

  constructor(code: PartnerCommunicationErrorCode) {
    super(code);
    this.name = 'PartnerCommunicationContractError';
    this.code = code;
  }
}

const ROOT_FIELDS = ['schemaVersion', 'eventId', 'eventType', 'occurredAt', 'partner', 'property', 'booking', 'guest', 'conversation'] as const;
const PARTNER_FIELDS = ['partnerId', 'accountId'] as const;
const PROPERTY_FIELDS = ['propertyId'] as const;
const BOOKING_FIELDS = ['bookingId', 'status', 'checkInAt', 'checkOutAt'] as const;
const GUEST_FIELDS = ['guestId', 'preferredLanguage'] as const;
const CONVERSATION_FIELDS = ['conversationId', 'messageId', 'channel', 'text'] as const;
const BOOKING_STATUSES = new Set<PartnerBookingStatus>(['confirmed', 'checked_in', 'checked_out', 'cancelled']);
const ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._:@/+\-]*$/u;
const MAX_ID_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 4_096;

type JsonObject = Record<string, unknown>;
type PartnerEntityType = 'account' | 'property' | 'booking' | 'guest' | 'conversation' | 'message' | 'event';

function fail(code: PartnerCommunicationErrorCode): never {
  throw new PartnerCommunicationContractError(code);
}

function object(value: unknown, code: PartnerCommunicationErrorCode): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value as JsonObject;
}

function exactFields(value: JsonObject, allowed: readonly string[], code: PartnerCommunicationErrorCode): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail(code);
}

function authoritativeId(
  value: unknown,
  errorCode: PartnerCommunicationErrorCode = 'partner_identity_invalid',
): string {
  if (typeof value !== 'string') fail(errorCode);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_ID_LENGTH || !ID_PATTERN.test(normalized)) {
    fail(errorCode);
  }
  return normalized;
}

function optionalAuthoritativeId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return authoritativeId(value);
}

function timestamp(value: unknown, code: PartnerCommunicationErrorCode): string {
  if (typeof value !== 'string' || !value.trim()) fail(code);
  const time = Date.parse(value);
  if (!Number.isFinite(time)) fail(code);
  return new Date(time).toISOString();
}

function optionalTimestamp(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return timestamp(value, 'partner_booking_state_invalid');
}

function segment(label: string, value: string): string {
  return `${label}${value.length}:${value}`;
}

function canonicalPartnerKey(
  entityType: PartnerEntityType,
  partnerIdValue: unknown,
  accountIdValue: unknown,
  externalIdValue?: unknown,
): string {
  const partnerId = authoritativeId(partnerIdValue);
  const accountId = authoritativeId(accountIdValue);
  const parts = ['partner:v1', entityType, segment('p', partnerId), segment('a', accountId)];
  if (entityType !== 'account') parts.push(segment('id', authoritativeId(externalIdValue)));
  return parts.join('|');
}

export function partnerAccountKey(partnerId: string, accountId: string): string {
  return canonicalPartnerKey('account', partnerId, accountId);
}

export function partnerPropertyKey(partnerId: string, accountId: string, propertyId: string): string {
  return canonicalPartnerKey('property', partnerId, accountId, propertyId);
}

export function partnerBookingKey(partnerId: string, accountId: string, bookingId: string): string {
  return canonicalPartnerKey('booking', partnerId, accountId, bookingId);
}

export function partnerGuestKey(partnerId: string, accountId: string, guestId: string): string {
  return canonicalPartnerKey('guest', partnerId, accountId, guestId);
}

export function partnerConversationKey(partnerId: string, accountId: string, conversationId: string): string {
  return canonicalPartnerKey('conversation', partnerId, accountId, conversationId);
}

export function partnerMessageKey(partnerId: string, accountId: string, messageId: string): string {
  return canonicalPartnerKey('message', partnerId, accountId, messageId);
}

export function partnerEventIdempotencyKey(partnerId: string, accountId: string, eventId: string): string {
  return canonicalPartnerKey('event', partnerId, accountId, eventId);
}

/**
 * Validate and normalize an event already delivered through a trusted server
 * call site. This function performs no authentication and must never be wired
 * directly to public/guest request bodies.
 */
export function validateTrustedPartnerCommunicationEvent(input: unknown): PartnerCommunicationContext {
  const root = object(input, 'partner_contract_invalid');
  exactFields(root, ROOT_FIELDS, 'partner_contract_invalid');

  if (root.schemaVersion !== PARTNER_COMMUNICATION_SCHEMA_VERSION) {
    fail('partner_schema_version_unsupported');
  }
  if (root.eventType !== PARTNER_COMMUNICATION_EVENT_TYPE) {
    fail('partner_event_type_unsupported');
  }

  const eventId = authoritativeId(root.eventId);
  const occurredAt = timestamp(root.occurredAt, 'partner_contract_invalid');

  const partner = object(root.partner, 'partner_identity_invalid');
  exactFields(partner, PARTNER_FIELDS, 'partner_identity_invalid');
  const partnerId = authoritativeId(partner.partnerId);
  const accountId = authoritativeId(partner.accountId);

  const property = object(root.property, 'partner_identity_invalid');
  exactFields(property, PROPERTY_FIELDS, 'partner_identity_invalid');
  const propertyId = authoritativeId(property.propertyId);

  const booking = object(root.booking, 'partner_booking_state_invalid');
  exactFields(booking, BOOKING_FIELDS, 'partner_booking_state_invalid');
  const bookingId = authoritativeId(booking.bookingId);
  const bookingStatus = booking.status === undefined || booking.status === null
    ? null
    : typeof booking.status === 'string' && BOOKING_STATUSES.has(booking.status as PartnerBookingStatus)
      ? booking.status as PartnerBookingStatus
      : fail('partner_booking_state_invalid');
  const checkInAt = optionalTimestamp(booking.checkInAt);
  const checkOutAt = optionalTimestamp(booking.checkOutAt);
  if (checkInAt && checkOutAt && Date.parse(checkOutAt) <= Date.parse(checkInAt)) {
    fail('partner_booking_state_invalid');
  }

  const guest = object(root.guest, 'partner_identity_invalid');
  exactFields(guest, GUEST_FIELDS, 'partner_identity_invalid');
  const guestId = optionalAuthoritativeId(guest.guestId);
  const preferredLanguage = guest.preferredLanguage === undefined || guest.preferredLanguage === null
    ? null
    : guest.preferredLanguage === 'ru'
      ? 'ru' as const
      : fail('partner_contract_invalid');

  const conversation = object(root.conversation, 'partner_message_invalid');
  exactFields(conversation, CONVERSATION_FIELDS, 'partner_message_invalid');
  const conversationId = authoritativeId(conversation.conversationId, 'partner_message_invalid');
  const messageId = authoritativeId(conversation.messageId, 'partner_message_invalid');
  if (conversation.channel !== 'partner_messaging') fail('partner_message_invalid');
  if (typeof conversation.text !== 'string') fail('partner_message_invalid');
  const messageText = conversation.text.trim();
  if (!messageText || messageText.length > MAX_MESSAGE_LENGTH) fail('partner_message_invalid');

  const identity = Object.freeze({
    partnerId,
    accountId,
    propertyId,
    bookingId,
    guestId,
    conversationId,
    messageId,
    eventId,
  });
  const keys = Object.freeze({
    partnerAccountKey: partnerAccountKey(partnerId, accountId),
    partnerPropertyKey: partnerPropertyKey(partnerId, accountId, propertyId),
    partnerBookingKey: partnerBookingKey(partnerId, accountId, bookingId),
    partnerGuestKey: guestId ? partnerGuestKey(partnerId, accountId, guestId) : null,
    partnerConversationKey: partnerConversationKey(partnerId, accountId, conversationId),
    partnerMessageKey: partnerMessageKey(partnerId, accountId, messageId),
    partnerEventIdempotencyKey: partnerEventIdempotencyKey(partnerId, accountId, eventId),
  });

  return Object.freeze({
    [TRUSTED_PARTNER_CONTEXT]: true as const,
    schemaVersion: PARTNER_COMMUNICATION_SCHEMA_VERSION,
    eventType: PARTNER_COMMUNICATION_EVENT_TYPE,
    occurredAt,
    identity,
    booking: Object.freeze({ status: bookingStatus, checkInAt, checkOutAt }),
    guest: Object.freeze({ preferredLanguage }),
    message: Object.freeze({ channel: 'partner_messaging' as const, text: messageText }),
    keys,
  });
}

export function isPartnerCommunicationContractError(error: unknown): error is PartnerCommunicationContractError {
  return error instanceof PartnerCommunicationContractError;
}

export function isTrustedPartnerCommunicationContext(value: unknown): value is PartnerCommunicationContext {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { [TRUSTED_PARTNER_CONTEXT]?: unknown })[TRUSTED_PARTNER_CONTEXT] === true,
  );
}
