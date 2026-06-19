import { InboundMessageEnvelope, IdentityResolution } from './types';
import { createOrMergeIdentity, resolveGuestIdentity } from './identity';
import { matchReservation } from './reservation';
import { auditIdentityDecision } from './audit';
import { loadAutonomousSession } from './conversation-session-store';

/**
 * Bind an inbound envelope to business entities (reservation/property/lead)
 * and classify a role for routing and session state.
 */
export async function bindIdentity(envelope: InboundMessageEnvelope): Promise<IdentityResolution> {
  const resolutionPath: string[] = [];
  const shouldCreateGuestIdentity =
    envelope.metadata?.guestTestMode === true ||
    envelope.metadata?.guest_test_mode === true ||
    String(envelope.messageText ?? '').trim().startsWith('/guest_test');
  // Resolve first. New Telegram senders must not become guests/leads just
  // because they wrote to the bot; creation is reserved for an explicit guest
  // test route or another later verified guest binding.
  const guest = shouldCreateGuestIdentity
    ? await createOrMergeIdentity(envelope).catch(() => null)
    : await resolveGuestIdentity(envelope).catch(() => null);
  if (guest) resolutionPath.push(shouldCreateGuestIdentity ? 'contact:createOrMergeIdentity' : 'contact:resolveGuestIdentity');

  // Prepare reservation match params
  const chatIdNum = envelope.chatId ? Number(envelope.chatId) : undefined;
  if (typeof chatIdNum === 'number' && Number.isFinite(chatIdNum)) resolutionPath.push('signal:chat_id');
  const phone = guest && guest.knownPhones && guest.knownPhones.length > 0 ? guest.knownPhones[0] : (envelope.phoneNumber ?? undefined);
  if (phone) resolutionPath.push('signal:phone');
  const guestName = guest ? `${guest.firstName ?? ''} ${guest.lastName ?? ''}`.trim() || undefined : undefined;
  if (guestName) resolutionPath.push('signal:guest_name');
  const bookingReference = envelope.metadata && (envelope.metadata['reservation_ref'] || envelope.metadata['bookingReference'] || envelope.metadata['booking_reference'])
    ? String(envelope.metadata['reservation_ref'] ?? envelope.metadata['bookingReference'] ?? envelope.metadata['booking_reference'])
    : undefined;
  if (bookingReference) resolutionPath.push('signal:booking_reference');
  const propertyLocation = envelope.metadata && (envelope.metadata['propertyLocation'] || envelope.metadata['property_location'])
    ? String(envelope.metadata['propertyLocation'] ?? envelope.metadata['property_location'])
    : undefined;
  if (propertyLocation) resolutionPath.push('signal:property_location');
  const checkInDate = envelope.metadata && envelope.metadata['checkInDate'] ? String(envelope.metadata['checkInDate']) : undefined;
  if (checkInDate) resolutionPath.push('signal:check_in_date');

  const params = {
    chatId: chatIdNum,
    phone,
    guestName,
    bookingReference,
    propertyLocation,
    checkInDate,
  };

  const reservation = await matchReservation(params).catch(() => ({ status: 'unmatched', confidence: 0 } as any));
  resolutionPath.push(`reservation:match:${reservation?.status ?? 'error'}`);

  // Simple role heuristics
  let role: IdentityResolution['role'] = 'unknown';
  let entityType: IdentityResolution['entityType'] = 'unknown';
  let entityId: string | undefined = undefined;
  let confidence = 0;
  let status: IdentityResolution['status'] = 'unresolved';
  let reason: string | undefined = undefined;

  // Operator / owner detection (best-effort): callers may pass metadata flags
  const isOperator =
    envelope.metadata && (envelope.metadata['isOperator'] === true || envelope.metadata['is_operator'] === true);
  const isOwner =
    envelope.metadata && (envelope.metadata['isOwner'] === true || envelope.metadata['is_owner'] === true);
  const isManager =
    envelope.metadata && (envelope.metadata['isManager'] === true || envelope.metadata['is_manager'] === true);
  const isTestGuest = shouldCreateGuestIdentity;
  const selectedSessionRole =
    typeof chatIdNum === 'number' && Number.isFinite(chatIdNum)
      ? loadAutonomousSession(chatIdNum)?.identity_role
      : undefined;

  // Telegram group chats are operational staff contexts by default.
  const isTelegramGroup = envelope.channel === 'telegram' && typeof chatIdNum === 'number' && chatIdNum < 0;

  if (isTestGuest) {
    role = 'test_guest';
    entityType = 'reservation';
    entityId = reservation?.reservationId;
    confidence = 1;
    status = 'resolved';
    reason = 'telegram_guest_test_mode';
    resolutionPath.push('role:test_guest');
  } else if (isOwner) {
    role = 'owner';
    entityType = 'unknown';
    confidence = 1;
    status = 'resolved';
    reason = 'metadata:is_owner';
    resolutionPath.push('role:owner');
  } else if (isManager) {
    role = 'manager';
    entityType = 'unknown';
    confidence = 1;
    status = 'resolved';
    reason = 'metadata:is_manager';
    resolutionPath.push('role:manager');
  } else if (
    selectedSessionRole === 'guest' ||
    selectedSessionRole === 'owner' ||
    selectedSessionRole === 'manager' ||
    selectedSessionRole === 'lead'
  ) {
    role = selectedSessionRole;
    entityType = selectedSessionRole === 'lead' ? 'lead' : 'unknown';
    confidence = 0.9;
    status = 'resolved';
    reason = 'telegram_button_selected_role';
    resolutionPath.push(`role:${selectedSessionRole}:session_selection`);
  } else if (isOperator || isTelegramGroup) {
    role = 'operator';
    entityType = 'unknown';
    confidence = 1;
    status = 'resolved';
    reason = isTelegramGroup ? 'telegram_group_chat' : 'metadata:is_operator';
    resolutionPath.push('role:operator');
  } else if (reservation && reservation.status === 'matched') {
    role = 'guest';
    entityType = 'reservation';
    entityId = reservation.reservationId;
    confidence = reservation.confidence ?? 0.9;
    status = 'resolved';
    reason = 'reservation:matched';
    resolutionPath.push('entity:reservation');
  } else if (reservation && reservation.status === 'ambiguous') {
    role = 'guest';
    entityType = 'reservation';
    confidence = reservation.confidence ?? 0.5;
    status = 'ambiguous';
    reason = 'reservation:ambiguous';
    resolutionPath.push('entity:reservation_ambiguous');
  } else if (guest) {
    role = 'unknown';
    entityType = 'unknown';
    confidence = 0.4;
    status = 'unresolved';
    reason = 'contact_known_no_reservation';
    resolutionPath.push('role:unknown_known_contact');
  } else {
    role = 'unknown';
    entityType = 'unknown';
    confidence = 0;
    status = 'unresolved';
    reason = 'no_identity';
    resolutionPath.push('role:unknown');
  }

  const out: IdentityResolution = {
    role,
    entityType,
    entityId,
    propertyId: reservation && reservation.propertyId ? reservation.propertyId : undefined,
    reservationId: reservation && reservation.reservationId ? reservation.reservationId : undefined,
    leadId: undefined,
    guestId: guest ? guest.guestId : undefined,
    confidence,
    status,
    reason,
    resolutionPath,
  };

  // Audit the identity decision (no raw message bodies)
  try {
    auditIdentityDecision({
      chat_id: (typeof chatIdNum === 'number' && Number.isFinite(chatIdNum)) ? chatIdNum : 0,
      detail: JSON.stringify({
        role: out.role,
        entityType: out.entityType,
        reservationId: out.reservationId ?? null,
        propertyId: out.propertyId ?? null,
        guestId: out.guestId ?? null,
        confidence: out.confidence,
        status: out.status,
        reason: out.reason,
        resolutionPath: out.resolutionPath ?? [],
      }),
    });
  } catch {
    // best-effort auditing
  }

  return out;
}

export default bindIdentity;
