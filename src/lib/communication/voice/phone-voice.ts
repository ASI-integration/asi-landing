/**
 * Phone / Telephony Voice Pipeline — Placeholder (future)
 *
 * Scope decision:
 * - Telegram is text-first in production.
 * - Voice is deferred and will be implemented via phone/telephony instead.
 *
 * This file intentionally defines a minimal interface boundary only.
 * Do not wire it into production routes until a real telephony provider
 * and compliance-safe recording/transcription story exist.
 */

export type PhoneVoiceInbound = {
  /** Provider call identifier (Twilio CallSid, etc.) */
  callId: string;
  /** E.164, if available */
  fromNumber?: string;
  /** E.164, if available */
  toNumber?: string;
  /** Provider recording identifier or URL (provider-specific) */
  recordingRef?: string;
  /** ISO timestamp from provider if available */
  receivedAt?: string;
  /** Optional provider payload for audit/debug (never log secrets) */
  raw?: Record<string, unknown>;
};

export type PhoneVoiceResult =
  | { outcome: 'ignored'; reason: string }
  | { outcome: 'not_implemented'; message: string };

export interface PhoneVoicePipeline {
  /**
   * Normalize inbound telephony voice into a transcript + metadata,
   * then route it into the communication orchestrator.
   *
   * Future expected steps:
   * - validate signature (provider webhook)
   * - fetch recording (if applicable)
   * - STT (provider or internal)
   * - call processMessage() with channel='phone' and metadata.voice fields
   */
  handleInboundVoice(payload: PhoneVoiceInbound): Promise<PhoneVoiceResult>;
}

export function createPhoneVoicePipeline(): PhoneVoicePipeline {
  return {
    async handleInboundVoice() {
      return {
        outcome: 'not_implemented',
        message: 'Phone/telephony voice pipeline is not implemented yet. Telegram remains text-first.',
      };
    },
  };
}

