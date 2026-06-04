import { EmailAdapter, type EmailInboundPayload } from './channels/email';
import { processEmailInbound } from './email-inbound-processor';

export type EmailPollingConfig = {
  configured: boolean;
  missing: string[];
  imap: {
    host: string;
    port: number;
    username: string;
  };
};

export type EmailPollResult = {
  ok: boolean;
  processed: number;
  skipped?: 'not_configured' | 'no_fetcher';
  missing?: string[];
};

export type EmailInboundFetcher = (config: EmailPollingConfig) => Promise<EmailInboundPayload[]>;

export function getEmailPollingConfig(env: NodeJS.ProcessEnv = process.env): EmailPollingConfig {
  const required = ['EMAIL_IMAP_HOST', 'EMAIL_IMAP_PORT', 'EMAIL_IMAP_USERNAME', 'EMAIL_IMAP_PASSWORD'] as const;
  const missing = required.filter((key) => !String(env[key] ?? '').trim());
  const port = Number(env.EMAIL_IMAP_PORT ?? 993);
  return {
    configured: missing.length === 0,
    missing,
    imap: {
      host: String(env.EMAIL_IMAP_HOST ?? '').trim(),
      port: Number.isFinite(port) ? port : 993,
      username: String(env.EMAIL_IMAP_USERNAME ?? '').trim(),
    },
  };
}

export async function pollEmailInboxOnce(params: {
  fetchInbound?: EmailInboundFetcher;
  adapter?: EmailAdapter;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<EmailPollResult> {
  const config = getEmailPollingConfig(params.env);
  if (!config.configured) {
    return { ok: true, processed: 0, skipped: 'not_configured', missing: config.missing };
  }
  if (!params.fetchInbound) {
    return { ok: true, processed: 0, skipped: 'no_fetcher' };
  }

  const adapter = params.adapter ?? new EmailAdapter();
  const messages = await params.fetchInbound(config);
  for (const raw of messages) {
    await processEmailInbound({ payload: raw, adapter });
  }
  return { ok: true, processed: messages.length };
}
