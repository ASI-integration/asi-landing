import { ChannelAdapter } from './base';
import type { CommunicationChannel } from '../types';
import { formatVoiceSafeText } from '../voice/formatter';

export class VoiceChannelAdapter implements ChannelAdapter {
  channel: CommunicationChannel;

  constructor(channel: CommunicationChannel) {
    this.channel = channel;
  }

  async sendMessage(to: string, content: string): Promise<boolean> {
    // Stub only: future provider-specific voice delivery will replace this.
    // Return true so the communication brain can complete the turn deterministically.
    console.info('[VoiceChannelAdapter] stub send', {
      channel: this.channel,
      to,
      preview: String(content ?? '').slice(0, 120),
    });
    return true;
  }

  formatResponse(rawMessage: string, _context: Record<string, unknown>): string {
    return formatVoiceSafeText(rawMessage);
  }
}

