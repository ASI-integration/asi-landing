import { ChannelAdapter } from './base';
import { TelegramAdapter } from './telegram';
import { EmailAdapter } from './email';
import { PhoneAdapter } from './phone';
import { MaxAdapter } from './max';
import { CommunicationChannel } from '../types';

const telegram = new TelegramAdapter();
const email = new EmailAdapter();
const phone = new PhoneAdapter();
const max = new MaxAdapter();

export function getChannelAdapter(channel: CommunicationChannel): ChannelAdapter {
  switch (channel) {
    case 'telegram': return telegram;
    case 'email': return email;
    case 'phone': return phone;
    case 'max': return max;
  }
}
