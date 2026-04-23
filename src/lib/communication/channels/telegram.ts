import { ChannelAdapter } from './base';
import { CommunicationChannel } from '../types';
import { replyToTelegram } from '../../telegram';

export class TelegramAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'telegram';

  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    const chatId = parseInt(to, 10);
    if (isNaN(chatId)) return false;

    try {
      // `replyToTelegram()` returns boolean (it does not throw on HTTP/network failure),
      // so we must propagate that result to the orchestrator.
      const handler =
        typeof metadata?.reply_handler === 'string' && metadata.reply_handler.length > 0
          ? metadata.reply_handler
          : 'telegram_adapter:unspecified_handler';
      const updateIdRaw = metadata?.update_id;
      const update_id = typeof updateIdRaw === 'number' && Number.isFinite(updateIdRaw) ? updateIdRaw : undefined;
      return await replyToTelegram(chatId, content, { handler, update_id });
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
