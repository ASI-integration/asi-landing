import { ChannelAdapter } from './base';
import { TelegramAdapter } from './telegram';
import { VkAdapter } from './vk';
import { EmailAdapter } from './email';
import { PhoneAdapter } from './phone';
import { MaxAdapter } from './max';
import { VoiceChannelAdapter } from './voice';
import { WhatsAppVoiceAdapter } from './whatsapp-voice';
import { CommunicationChannel } from '../types';

const telegram = new TelegramAdapter();
const vk       = new VkAdapter();
const email    = new EmailAdapter();
const phone    = new PhoneAdapter();
const max      = new MaxAdapter();
const telegramVoice = new VoiceChannelAdapter('telegram_voice');
const whatsappVoice = new WhatsAppVoiceAdapter();

export function getChannelAdapter(channel: CommunicationChannel): ChannelAdapter {
  switch (channel) {
    case 'telegram': return telegram;
    case 'telegram_voice': return telegramVoice;
    case 'whatsapp_voice': return whatsappVoice;
    case 'vk':       return vk;
    case 'email':    return email;
    case 'phone':    return phone;
    case 'max':      return max;
  }
}
