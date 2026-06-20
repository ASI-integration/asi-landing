import { ChannelAdapter } from './base';
import { CommunicationChannel } from '../types';
import { replyToTelegram } from '../../telegram';
import { patchAutonomousSessionCollectedData } from '../conversation-session-store';
import { appendVoiceFirstNoticeIfNeeded } from '../voice-outbound';
import { isVoiceReplyGloballyEnabled, sendVoiceReply } from '../voice-reply';
import type { VoiceResponseDecision } from '../voice-response-policy';

function voiceFallbackText(content: string): string {
  const text = String(content ?? '').trim();
  return text || 'Спасибо, сообщение получил. Уточню детали и вернусь с ответом.';
}

function readVoiceDecision(metadata?: Record<string, unknown>): VoiceResponseDecision | null {
  const raw = metadata?.voice_response_decision;
  if (!raw || typeof raw !== 'object') return null;
  return raw as VoiceResponseDecision;
}

export class TelegramAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'telegram';

  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    const chatId = parseInt(to, 10);
    if (isNaN(chatId)) return false;

    try {
      let textFallback = voiceFallbackText(content);
      textFallback = appendVoiceFirstNoticeIfNeeded(textFallback, metadata);

      const decision = readVoiceDecision(metadata);
      if (isVoiceReplyGloballyEnabled() && decision?.shouldSendVoice) {
        const voiceSent = await sendVoiceReply(chatId, { chatId, decision });
        if (voiceSent && metadata?.voice_append_first_notice) {
          patchAutonomousSessionCollectedData({
            chatId,
            channel: 'telegram',
            set: { voice_notice_sent: 'true' },
          });
        }
        if (!voiceSent) {
          console.warn('[tg:voice] voice_reply.text_fallback', {
            chat_id: chatId,
            update_id: typeof metadata?.update_id === 'number' ? metadata.update_id : null,
            reason: decision.reason,
          });
        }
      }

      const handler =
        typeof metadata?.reply_handler === 'string' && metadata.reply_handler.length > 0
          ? metadata.reply_handler
          : 'telegram_adapter:unspecified_handler';
      const updateIdRaw = metadata?.update_id;
      const update_id = typeof updateIdRaw === 'number' && Number.isFinite(updateIdRaw) ? updateIdRaw : undefined;
      const replyMarkup =
        metadata?.reply_markup && typeof metadata.reply_markup === 'object'
          ? (metadata.reply_markup as Record<string, unknown>)
          : undefined;

      return await replyToTelegram(chatId, textFallback, { handler, update_id, reply_markup: replyMarkup });
    } catch (e) {
      console.error('[TelegramAdapter] Failed to send message', e);
      return false;
    }
  }

  formatResponse(rawMessage: string, context: Record<string, unknown>): string {
    let formatted = rawMessage.trim();
    if (formatted.length > 2000) {
      formatted = formatted.substring(0, 1997) + '...';
    }
    return formatted;
  }
}
