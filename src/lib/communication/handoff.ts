import { CommunicationContext, OperatorHandoffPayload } from './types';
import { classifyIssuePriority } from './triage';
import { extractSlots } from './classifier';

export function buildOperatorHandoff(
  context: CommunicationContext,
  text: string,
  recommendedAction: string,
  reasonForEscalation: string
): OperatorHandoffPayload {
  const { reservation, intentResult, recentMessages } = context;
  const slots = extractSlots(text);
  const priority = classifyIssuePriority(text, intentResult.intent, slots);

  let guestSummary = 'Unknown Guest';
  if (reservation.status === 'matched') {
    guestSummary = `${reservation.guestName || 'Unknown Name'} | Res: ${reservation.reservationId}`;
  } else if (reservation.status === 'ambiguous') {
    guestSummary = 'Ambiguous - Multiple Candidates';
  }

  const lastMessagesSummary = recentMessages
    .slice(-3)
    .map(m => `[${m.role.toUpperCase()}] ${m.content}`)
    .join('\n');

  return {
    guestSummary,
    detectedIntent: `${intentResult.intent} (Confidence: ${(intentResult.confidence * 100).toFixed(0)}%)`,
    reservationStatus: reservation.status,
    issuePriority: priority,
    lastMessagesSummary,
    recommendedAction,
    reasonForEscalation,
  };
}
