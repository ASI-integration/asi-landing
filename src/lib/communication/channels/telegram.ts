import { ChannelAdapter } from './base';
import { CommunicationChannel } from '../types';
import { replyToTelegram } from '../../telegram';

export class TelegramAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'telegram';

  async sendMessage(to: string, content: string): Promise<boolean> {
    const chatId = parseInt(to, 10);
    if (isNaN(chatId)) return false;

    try {
      // `replyToTelegram()` returns boolean (it does not throw on HTTP/network failure),
      // so we must propagate that result to the orchestrator.
      return await replyToTelegram(chatId, content);
    } catch (e) {
      console.error('[TelegramAdapter] Failed to send message', e);
      return false;
    }
  }

  formatResponse(rawMessage: string, context: Record<string, unknown>): string {
    // Keep Telegram responses conversational, relatively short
    let formatted = rawMessage.trim();
    if (formatted.length > 2000) {
      formatted = formatted.substring(0, 1997) + '...';
    }
    return formatted;
  }
}
