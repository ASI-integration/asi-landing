import { ChannelAdapter } from './base';
import { CommunicationChannel } from '../types';

export class PhoneAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'phone';

  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    // We are NOT doing AI Voice generation yet
    // Rather, "sendMessage" for a phone might mean dispatching an SMS follow-up, 
    // or dropping a note onto the operator's call management UI.
    console.log(`[PhoneAdapter] Logging follow-up for phone contact ${to}: ${content}`);
    return true;
  }

  formatResponse(rawMessage: string, context: Record<string, unknown>): string {
    // Operator facing summaries
    return `[Call Follow-up / Operator Notes]\n${rawMessage}`;
  }
}
