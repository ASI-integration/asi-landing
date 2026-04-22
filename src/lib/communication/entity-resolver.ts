import { CommunicationContext, CommunicationEntityResolution, IdentityResolution, ResolvedCandidate } from './types';

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

/**
 * Evidence-based entity resolution across identity binding, reservation matcher,
 * channel identifiers, and session memory.
 *
 * CRITICAL: this must never "guess" a reservation/property/lead link.
 */
export function resolveEntities(input: {
  text: string;
  identity: IdentityResolution;
  context: CommunicationContext;
}): CommunicationEntityResolution {
  const evidence: string[] = [];
  const candidates: ResolvedCandidate[] = [];

  // 1) Strongest: identity-binding already matched a reservation.
  if (input.identity.reservationId) {
    evidence.push('identity.reservationId');
    if (input.identity.reason) evidence.push(`identity.reason:${input.identity.reason}`);
    if (input.identity.resolutionPath && input.identity.resolutionPath.length > 0) {
      evidence.push(`identity.path:${input.identity.resolutionPath.join('>')}`);
    }
    return {
      reservationId: input.identity.reservationId,
      propertyId: input.identity.propertyId,
      leadId: input.identity.leadId,
      status: 'resolved',
      evidence: uniq(evidence),
    };
  }

  // 2) CommunicationContext reservation matcher result.
  const match = input.context.reservation;
  if (match.status === 'matched' && match.reservationId) {
    evidence.push('context.reservation.matched');
    return {
      reservationId: match.reservationId,
      propertyId: match.propertyId,
      leadId: input.identity.leadId,
      status: 'resolved',
      evidence: uniq(evidence),
    };
  }

  if (match.status === 'ambiguous' && Array.isArray(match.candidates) && match.candidates.length > 0) {
    evidence.push('context.reservation.ambiguous');
    for (const c of match.candidates.slice(0, 5)) {
      candidates.push({
        type: 'reservation',
        id: c.reservationId,
        reason: `candidate from reservation match (guest=${c.guestName ?? 'unknown'} checkIn=${c.checkIn ?? 'unknown'})`,
      });
    }
    return {
      status: 'ambiguous',
      evidence: uniq(evidence),
      candidates,
    };
  }

  // 3) Identity indicates "reservation ambiguous" but without IDs: keep ambiguous.
  if (input.identity.status === 'ambiguous' && input.identity.entityType === 'reservation') {
    evidence.push('identity.status:ambiguous');
    if (input.identity.reason) evidence.push(`identity.reason:${input.identity.reason}`);
    return {
      status: 'ambiguous',
      evidence: uniq(evidence),
      candidates: candidates.length > 0 ? candidates : undefined,
    };
  }

  // 4) If we at least have a propertyId via identity, treat property as resolved,
  // but reservation is still unresolved. This is safe for property templates/knowledge,
  // but never claim a specific reservation.
  if (input.identity.propertyId) {
    evidence.push('identity.propertyId');
    return {
      propertyId: input.identity.propertyId,
      leadId: input.identity.leadId,
      status: 'resolved',
      evidence: uniq(evidence),
    };
  }

  // 5) Memory hints (staff bridge) are NOT sufficient for resolution on their own.
  // They can be used for candidate explanation but should keep status unresolved.
  if (input.context.memory.bookingReference) evidence.push('memory.bookingReference');
  if (input.context.memory.propertyLocation) evidence.push('memory.propertyLocation');
  if (input.context.memory.guestName) evidence.push('memory.guestName');
  if (input.context.memory.checkInDate) evidence.push('memory.checkInDate');

  // 6) LeadId is not currently resolved in this module reliably; keep unresolved.
  return {
    status: evidence.length > 0 ? 'unresolved' : 'unresolved',
    leadId: input.identity.leadId,
    evidence: uniq(evidence.length > 0 ? evidence : ['no_strong_signals']),
  };
}

