/**
 * Phone Channel Adapter — Placeholder
 *
 * This adapter defines the contract for SMS/voice support without any
 * provider-specific implementation.  A full implementation would wire in
 * a telephony provider such as Twilio, TATA, or МТТ (for RU).
 *
 * Supported when fully implemented:
 *   - Inbound SMS normalisation (normalizeInbound)
 *   - Outbound SMS replies (sendMessage)
 *   - Missed-call / voicemail logging (PhoneCallRecord via timeline)
 *
 * Required env vars (not yet consumed):
 *   PHONE_PROVIDER          — 'twilio' | 'mtt' | 'custom'
 *   PHONE_ACCOUNT_SID       — provider account identifier
 *   PHONE_AUTH_TOKEN        — provider auth token
 *   PHONE_FROM_NUMBER       — outbound sender number (E.164)
 *
 * API route:
 *   /api/phone/inbound — provider webhook for inbound SMS (not yet created)
 */

import { ChannelAdapter } from './base';
import { CommunicationChannel, InboundMessageEnvelope } from '../types';

export class PhoneAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'phone';

  /**
   * Normalise an inbound SMS payload from the configured provider.
   * Shape is provider-specific — this is intentionally unimplemented.
   */
  async normalizeInbound(_rawPayload: unknown): Promise<InboundMessageEnvelope> {
    throw new Error(
      '[PhoneAdapter] normalizeInbound: not yet implemented. ' +
      'Wire a telephony provider (Twilio, МТТ, etc.) before enabling phone inbound.',
    );
  }

  /**
   * Dispatch an outbound SMS or drop an operator-visible note.
   * Currently logs the intent; replace with provider SDK call.
   */
  async sendMessage(to: string, content: string, _metadata?: Record<string, unknown>): Promise<boolean> {
    console.log(`[PhoneAdapter] stub — would send SMS to ${to}: ${content.slice(0, 80)}`);
    // Return false so delivery layer knows the message was not actually sent,
    // which will push it to the DLQ for operator review.
    return false;
  }

  formatResponse(rawMessage: string, _context: Record<string, unknown>): string {
    // Phone follow-up notes are operator-facing. Prefix is used by the operator leads UI.
    return `[Call Follow-up / Operator Notes]\n${rawMessage.trim()}`;
  }
}
