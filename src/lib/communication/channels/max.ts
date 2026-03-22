import { ChannelAdapter } from './base';
import { CommunicationChannel } from '../types';

export class MaxAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'max';

  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    // TODO: Connect this to the actual Max delivery APIs when infra is ready.
    console.warn(`[MaxAdapter] Stub called to send message to ${to}. Content: ${content}`);
    return true;
  }

  formatResponse(rawMessage: string, context: Record<string, unknown>): string {
    // Max interactions will probably mimic Telegram closely (conversational)
    return rawMessage.trim();
  }
}
