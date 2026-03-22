import { InboundMessageEnvelope, CommunicationChannel } from '../types';

export interface ChannelAdapter {
  /** The unique identifier for this channel format */
  channel: CommunicationChannel;

  /**
   * Adapts the underlying provider's format into a safe standard envelope
   */
  normalizeInbound?(rawPayload: any): Promise<InboundMessageEnvelope>;

  /**
   * Dispatches a text response safely down this channel
   */
  sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<boolean>;

  /**
   * Format the final response specifically for this channel's constraints
   * Ex: Telegram expects short paragraphs, Email expects full signatures.
   */
  formatResponse(rawMessage: string, context: Record<string, unknown>): string;
}
