import type { ChannelAdapter } from './base';
import type { CommunicationChannel } from '../types';
import { replyToTelegram } from '../../telegram';
import { formatVoiceSafeText } from '../voice/formatter';

export class TelegramVoiceAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'telegram_voice';

  async sendMessage(to: string, content: string): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') return true;
    const chatId = Number.parseInt(String(to), 10);
    if (!Number.isFinite(chatId)) return false;
    try {
      return await replyToTelegram(chatId, content);
    } catch (e) {
      console.error('[TelegramVoiceAdapter] Failed to send message', e);
      return false;
    }
  }

  formatResponse(rawMessage: string): string {
    return formatVoiceSafeText(rawMessage);
  }
}

