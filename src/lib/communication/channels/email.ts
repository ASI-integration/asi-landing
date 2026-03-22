import { ChannelAdapter } from './base';
import { CommunicationChannel } from '../types';

export class EmailAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'email';

  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    // In reality this integrates with Resend, AWS SES, or SendGrid
    console.log(`[EmailAdapter] Sending email to ${to}:
Subject: ${metadata?.subject || 'Re: Your Inquiry'}
Body:
${content}`);
    return true;
  }

  formatResponse(rawMessage: string, context: Record<string, unknown>): string {
    // Email expects structured professional signatures and polished styling
    const signature = `\n\nBest regards,\nThe AutomationASI Team\nsupport@automationasi.com`;
    return `${rawMessage.trim()}${signature}`;
  }
}
