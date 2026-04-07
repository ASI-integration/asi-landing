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
import { extractStaffClues } from './staff-bridge';
import { updateContext } from './memory';

export async function buildCommunicationContext(
  chatId: number,
  text: string,
  intentResult: { intent: IntentCategory; confidence: number },
  recentMessages: MessageTurn[]
): Promise<CommunicationContext> {
  const memory = getContext(chatId);

  const isStaffGroupChat = chatId < 0;

  // Staff-mode bridge: operator group chat doesn't share the guest chat_id,
  // so we extract structured clues and try matching via reference/name/location/date.
  if (isStaffGroupChat) {
    const extracted = extractStaffClues(text);
    if (Object.keys(extracted).length > 0) {
      updateContext(chatId, {
        ...(extracted.bookingReference ? { bookingReference: extracted.bookingReference } : null),
        ...(extracted.guestName ? { guestName: extracted.guestName } : null),
        ...(extracted.propertyLocation ? { propertyLocation: extracted.propertyLocation } : null),
        ...(extracted.checkInDate ? { checkInDate: extracted.checkInDate } : null),
      });
    }
  }

  const mem = getContext(chatId);

  // Use memory or current exact identifiers to find reservation
  const reservationMatch = await matchReservation({
    chatId: isStaffGroupChat ? undefined : chatId,
    guestName: mem.guestName,
    bookingReference: mem.bookingReference,
    propertyLocation: mem.propertyLocation,
    checkInDate: mem.checkInDate,
  });

  // Fetch grounded knowledge based on the matched property
  const knowledge = await getGroundedKnowledge(reservationMatch.propertyId);

  return {
    chatId,
    memory: mem,
    intentResult,
    reservation: reservationMatch,
    knowledge,
    recentMessages,
  };
}
