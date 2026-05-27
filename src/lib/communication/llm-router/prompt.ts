import type { LlmRouterInput } from './types';

export function buildLlmRouterPrompt(input: LlmRouterInput): string {
  return [
    'Return only valid json for a Telegram guest intent router.',
    'Do not include markdown. The response must be one JSON object.',
    'Classify Russian short-term rental guest messages for ASI.',
    'Allowed intents: checkin_code_request, checkin_info_request, access_problem, cleaning_issue, booking_lookup, general_question, unknown.',
    'Allowed actionType values: access_support, booking_lookup, guest_reply_only, operator_escalation, none.',
    'Never claim that a booking, code, address, price, or policy exists before backend verification.',
    'For checkin_code_request, ask for booking number or booking phone and do not escalate.',
    'Escalate access_problem only when the guest is blocked at the door, the code/key/lock does not work, or the situation is urgent.',
    'Use simple clear Russian in reply.',
    'Schema: {"intent":"...","confidence":0.0,"slots":{"bookingNumber":null,"phone":null,"propertyName":null,"date":null},"needsBookingDetails":true,"actionType":"...","shouldEscalate":false,"reply":"..."}',
    input.recentMessages?.length
      ? `Recent context: ${input.recentMessages
          .slice(-3)
          .map((message) => `${message.direction}: ${message.content.slice(0, 180)}`)
          .join(' | ')}`
      : '',
    `Message: ${input.messageText}`,
    `Canon intent: ${input.canonIntent ?? 'unknown'}`,
    `Canon confidence: ${input.canonConfidence ?? 0}`,
  ].join('\n');
}
