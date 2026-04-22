import { ChannelAdapter } from './base';
import type { CommunicationChannel } from '../types';
import { formatVoiceSafeText } from '../voice/formatter';

function debugEnabled(): boolean {
  return process.env.COMM_PIPELINE_DEBUG === '1' || process.env.WHATSAPP_DEBUG === '1';
}

function required(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : null;
}

function graphBase(): string {
  return (process.env.WHATSAPP_GRAPH_BASE_URL ?? 'https://graph.facebook.com').replace(/\/+$/, '');
}

function graphVersion(): string {
  return String(process.env.WHATSAPP_GRAPH_VERSION ?? 'v20.0').trim();
}

export class WhatsAppVoiceAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'whatsapp_voice';

  async sendMessage(to: string, content: string): Promise<boolean> {
    const token = required('WHATSAPP_ACCESS_TOKEN');
    const phoneNumberId = required('WHATSAPP_PHONE_NUMBER_ID');
    if (!token) {
      console.error('[wa:outbound] missing_env.WHATSAPP_ACCESS_TOKEN');
      return false;
    }
    if (!phoneNumberId) {
      console.error('[wa:outbound] missing_env.WHATSAPP_PHONE_NUMBER_ID');
      return false;
    }

    const url = `${graphBase()}/${graphVersion()}/${encodeURIComponent(phoneNumberId)}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: content },
    };

    if (debugEnabled()) {
      console.log('[wa:outbound] send.start', { to, preview: String(content ?? '').slice(0, 120) });
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error('[wa:outbound] send.fail_http', { status: res.status, body: t.slice(0, 250) });
        return false;
      }
      if (debugEnabled()) {
        const data = await res.json().catch(() => null);
        console.log('[wa:outbound] send.ok', { has_response: Boolean(data) });
      }
      return true;
    } catch (err) {
      console.error('[wa:outbound] send.fail_network', err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  formatResponse(rawMessage: string): string {
    return formatVoiceSafeText(rawMessage);
  }
}

