import { ChannelAdapter } from './base';
import { CommunicationChannel } from '../types';
import { replyToTelegram } from '../../telegram';
import { getVoiceReplyMode, sendVoiceReply } from '../voice-reply';

function voiceReplyRequested(metadata?: Record<string, unknown>): boolean {
  if (process.env.VOICE_REPLY_ENABLED !== '1') return false;
  const mode = getVoiceReplyMode();
  if (mode === 'text') return false;
  if (mode === 'voice' || mode === 'both') return true;
  return metadata?.voice_reply_source === 'inbound_voice';
}

function voiceFallbackText(content: string): string {
  const text = String(content ?? '').trim();
  return text || 'Спасибо, сообщение получил. Уточню детали и вернусь с ответом.';
}

export class TelegramAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'telegram';

  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    const chatId = parseInt(to, 10);
    if (isNaN(chatId)) return false;

    try {
      const textFallback = voiceFallbackText(content);
      if (voiceReplyRequested(metadata)) {
        const voiceSent = await sendVoiceReply(chatId, textFallback, {
          chatId,
          voiceEnabled: true,
          isEscalation: Boolean(metadata?.voice_reply_is_escalation),
          isPayment: Boolean(metadata?.voice_reply_is_payment),
          isCheckinInstructions: Boolean(metadata?.voice_reply_is_checkin_instructions),
        });
        if (voiceSent && getVoiceReplyMode() !== 'both') return true;
        if (!voiceSent) {
          console.warn('[tg:voice] voice_reply.text_fallback', {
            chat_id: chatId,
            update_id: typeof metadata?.update_id === 'number' ? metadata.update_id : null,
          });
        }
      }

      // `replyToTelegram()` returns boolean (it does not throw on HTTP/network failure),
      // so we must propagate that result to the orchestrator.
      const handler =
        typeof metadata?.reply_handler === 'string' && metadata.reply_handler.length > 0
          ? metadata.reply_handler
          : 'telegram_adapter:unspecified_handler';
      const updateIdRaw = metadata?.update_id;
      const update_id = typeof updateIdRaw === 'number' && Number.isFinite(updateIdRaw) ? updateIdRaw : undefined;
      return await replyToTelegram(chatId, textFallback, { handler, update_id });
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
