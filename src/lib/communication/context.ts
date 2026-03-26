import {
  CommunicationContext,
  IntentCategory,
  ConversationContext,
  MessageTurn,
  ReservationMatchResult,
} from './types';
import { getContext } from './memory';
import { matchReservation } from './reservation';
import { getGroundedKnowledge } from './knowledge';

export async function buildCommunicationContext(
  chatId: number,
  text: string,
  intentResult: { intent: IntentCategory; confidence: number },
  recentMessages: MessageTurn[]
): Promise<CommunicationContext> {
  const memory = getContext(chatId);

  // Use memory or current exact identifiers to find reservation
  const reservationMatch = await matchReservation({
    chatId,
    guestName: memory.guestName ?? memory.bookingDraft?.guestName,
  });

  // Fetch grounded knowledge based on the matched property
  const knowledge = await getGroundedKnowledge(reservationMatch.propertyId);

  return {
    chatId,
    memory,
    intentResult,
    reservation: reservationMatch,
    knowledge,
    recentMessages,
  };
}
