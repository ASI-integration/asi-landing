/**
 * Email guest communication adapter.
 *
 * Email is a transport only: inbound messages are normalized into the shared
 * communication envelope and outbound replies are delivered through SMTP. All
 * business policy stays in the canonical communication core.
 */

import { createHash, randomUUID } from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { ChannelAdapter } from './base';
import { shouldSuppressEmailOutbound } from '../email-outbound-safe-mode';
import { CommunicationChannel, InboundMessageEnvelope } from '../types';

export type EmailAddressInput =
  | string
  | { address?: string | null; email?: string | null; name?: string | null }
  | Array<string | { address?: string | null; email?: string | null; name?: string | null }>;

export interface EmailInboundPayload {
  from: EmailAddressInput;
  to?: EmailAddressInput;
  cc?: EmailAddressInput;
  subject?: string;
  text?: string;
  bodyText?: string;
  html?: string;
  messageId?: string;
  message_id?: string;
  threadId?: string;
  thread_id?: string;
  uid?: string | number;
  inReplyTo?: string;
  in_reply_to?: string;
  references?: string | string[];
  replyTo?: EmailAddressInput;
  reply_to?: EmailAddressInput;
  date?: string;
  headers?: Record<string, string | string[] | undefined>;
  attachments?: Array<{
    filename?: string;
    name?: string;
    contentType?: string;
    content_type?: string;
    size?: number;
    bytes?: number;
    contentId?: string;
    content_id?: string;
  }>;
}

export type ResendInboundPayload = EmailInboundPayload;

type SmtpConfig = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  fromAddress: string;
};

type SmtpSocket = net.Socket | tls.TLSSocket;

export class EmailAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'email';

  async normalizeInbound(rawPayload: EmailInboundPayload): Promise<InboundMessageEnvelope> {
    const fromEmail = getPrimaryEmailAddress(rawPayload.from);
    const body = rawPayload.bodyText ?? rawPayload.text ?? stripHtml(rawPayload.html ?? '');
    const messageId =
      normalizeMessageId(rawPayload.messageId) ??
      normalizeMessageId(rawPayload.message_id) ??
      normalizeMessageId(headerValue(rawPayload.headers, 'message-id'));
    const providerMessageId =
      messageId ??
      normalizeMessageId(rawPayload.uid) ??
      stableEmailId([fromEmail, rawPayload.subject ?? '', rawPayload.date ?? '', body]);
    const inReplyTo =
      normalizeMessageId(rawPayload.inReplyTo) ??
      normalizeMessageId(rawPayload.in_reply_to) ??
      normalizeMessageId(headerValue(rawPayload.headers, 'in-reply-to'));
    const references = rawPayload.references ?? headerValue(rawPayload.headers, 'references') ?? inReplyTo;
    const threadId =
      normalizeMessageId(rawPayload.threadId) ??
      normalizeMessageId(rawPayload.thread_id) ??
      inReplyTo ??
      messageId ??
      providerMessageId;
    const attachments = normalizeAttachments(rawPayload.attachments);

    return {
      channel: 'email',
      externalUserId: fromEmail,
      email: fromEmail,
      messageText: body.trim(),
      subject: rawPayload.subject,
      receivedAt: parseDate(rawPayload.date),
      update_id: stablePositiveInt(providerMessageId),
      metadata: {
        transport: 'email',
        original_message_type: 'email',
        provider: 'email',
        from: fromEmail,
        bodyText: body.trim(),
        providerMessageId,
        externalMessageId: providerMessageId,
        message_id: messageId ?? providerMessageId,
        messageId: messageId ?? providerMessageId,
        thread_id: threadId,
        threadId,
        uid: rawPayload.uid ?? null,
        in_reply_to: inReplyTo ?? null,
        references: references ?? null,
        reply_to: normalizeEmailAddressList(rawPayload.replyTo ?? rawPayload.reply_to),
        to: normalizeEmailAddressList(rawPayload.to),
        cc: normalizeEmailAddressList(rawPayload.cc),
        attachments,
        subject: rawPayload.subject ?? null,
      },
    };
  }

  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    // Defense-in-depth: draft-only / auto-send-off must block even if a caller
    // bypasses the orchestrator dry-run path.
    if (shouldSuppressEmailOutbound()) {
      console.info('[EmailAdapter] outbound suppressed (draft_only)', {
        to: extractEmailAddress(to) || null,
        content_len: String(content ?? '').length,
        subject: metadata?.subject ?? null,
      });
      return true;
    }

    const config = getSmtpConfig();
    if (!config) {
      console.error('[EmailAdapter] SMTP is not configured');
      return false;
    }

    const recipient = extractEmailAddress(to);
    if (!recipient) {
      console.error('[EmailAdapter] recipient email is empty');
      return false;
    }

    const subject = normalizeReplySubject(metadata?.subject);
    const inReplyTo = stringOrUndefined(metadata?.in_reply_to);
    const references = stringOrUndefined(metadata?.references) ?? inReplyTo;

    try {
      await sendSmtpMessage({
        config,
        to: recipient,
        subject,
        text: content,
        inReplyTo,
        references,
      });
      return true;
    } catch (error) {
      console.error('[EmailAdapter] sendMessage failed', error);
      return false;
    }
  }

  formatResponse(rawMessage: string, _context: Record<string, unknown>): string {
    const from = process.env.EMAIL_FROM_ADDRESS ?? process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'support@asi-global.ru';
    const signature = `\n\nBest regards,\nASI Support\n${from}`;
    return `${rawMessage.trim()}${signature}`;
  }
}

export function getPrimaryEmailAddress(input: EmailAddressInput | undefined): string {
  return normalizeEmailAddressList(input)[0] ?? '';
}

export function normalizeEmailAddressList(input: EmailAddressInput | undefined): string[] {
  if (!input) return [];
  const values = Array.isArray(input) ? input : [input];
  return values
    .map((value) => {
      if (typeof value === 'string') return extractEmailAddress(value);
      return extractEmailAddress(value.email ?? value.address ?? '');
    })
    .filter((value): value is string => Boolean(value));
}

export function extractEmailAddress(header: string): string {
  const match = String(header ?? '').match(/<([^>]+)>/);
  const candidate = (match ? match[1] : header).trim().toLowerCase();
  const email = candidate.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i)?.[0];
  return email ? email.toLowerCase() : candidate;
}

function getSmtpConfig(): SmtpConfig | null {
  const host = String(process.env.EMAIL_SMTP_HOST ?? '').trim();
  const fromAddress = extractEmailAddress(String(process.env.EMAIL_FROM_ADDRESS ?? '').trim());
  if (!host || !fromAddress) return null;
  const port = Number(process.env.EMAIL_SMTP_PORT ?? 587);
  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    username: stringOrUndefined(process.env.EMAIL_SMTP_USERNAME),
    password: stringOrUndefined(process.env.EMAIL_SMTP_PASSWORD),
    fromAddress,
  };
}

function parseDate(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function headerValue(headers: EmailInboundPayload['headers'], key: string): string | undefined {
  if (!headers) return undefined;
  const foundKey = Object.keys(headers).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  const value = foundKey ? headers[foundKey] : undefined;
  if (Array.isArray(value)) return value.find((item) => String(item).trim());
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeMessageId(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  return text.replace(/^<|>$/g, '');
}

function stableEmailId(parts: string[]): string {
  return createHash('sha256')
    .update(parts.join('|'))
    .digest('hex');
}

function stablePositiveInt(value: string): number {
  const hash = createHash('sha256').update(value).digest();
  const n = hash.readUInt32BE(0);
  return n === 0 ? 1 : n;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function normalizeReplySubject(value: unknown): string {
  const subject = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!subject) return 'Re: Your request';
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

function normalizeAttachments(input: EmailInboundPayload['attachments']): Array<Record<string, unknown>> {
  if (!Array.isArray(input)) return [];
  return input.map((item) => ({
    filename: item.filename ?? item.name ?? null,
    content_type: item.contentType ?? item.content_type ?? null,
    size: typeof item.size === 'number' ? item.size : typeof item.bytes === 'number' ? item.bytes : null,
    content_id: item.contentId ?? item.content_id ?? null,
  }));
}

function stringOrUndefined(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text ? text : undefined;
}

function encodeHeader(value: string): string {
  const cleaned = value.replace(/[\r\n]+/g, ' ').trim();
  if (/^[\x20-\x7e]*$/.test(cleaned)) return cleaned;
  return `=?UTF-8?B?${Buffer.from(cleaned, 'utf8').toString('base64')}?=`;
}

function dotStuff(text: string): string {
  return text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

async function sendSmtpMessage(params: {
  config: SmtpConfig;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
}): Promise<void> {
  let socket: SmtpSocket = await connectSmtp(params.config);
  await readSmtpResponse(socket);

  let ehlo = await smtpCommand(socket, `EHLO ${localHostname()}`);
  if (params.config.port !== 465 && /STARTTLS/i.test(ehlo.text)) {
    await smtpCommand(socket, 'STARTTLS');
    socket = await upgradeToTls(socket, params.config.host);
    ehlo = await smtpCommand(socket, `EHLO ${localHostname()}`);
  }

  if (params.config.username && params.config.password) {
    await smtpCommand(socket, 'AUTH LOGIN', [334]);
    await smtpCommand(socket, Buffer.from(params.config.username).toString('base64'), [334]);
    await smtpCommand(socket, Buffer.from(params.config.password).toString('base64'), [235]);
  }

  await smtpCommand(socket, `MAIL FROM:<${params.config.fromAddress}>`);
  await smtpCommand(socket, `RCPT TO:<${params.to}>`);
  await smtpCommand(socket, 'DATA', [354]);

  const headers = [
    `From: ${params.config.fromAddress}`,
    `To: ${params.to}`,
    `Subject: ${encodeHeader(params.subject)}`,
    `Message-ID: <${randomUUID()}@asi.local>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  if (params.inReplyTo) headers.push(`In-Reply-To: ${formatMessageIdHeader(params.inReplyTo)}`);
  if (params.references) headers.push(`References: ${formatMessageIdHeader(params.references)}`);

  socket.write(`${headers.join('\r\n')}\r\n\r\n${dotStuff(params.text)}\r\n.\r\n`);
  await readSmtpResponse(socket, [250]);
  await smtpCommand(socket, 'QUIT', [221]);
  socket.end();
}

function connectSmtp(config: SmtpConfig): Promise<SmtpSocket> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    if (config.port === 465) {
      const socket = tls.connect({ host: config.host, port: config.port, servername: config.host }, () => {
        socket.off('error', onError);
        resolve(socket);
      });
      socket.once('error', onError);
      return;
    }
    const socket = net.createConnection({ host: config.host, port: config.port }, () => {
      socket.off('error', onError);
      resolve(socket);
    });
    socket.once('error', onError);
  });
}

function upgradeToTls(socket: SmtpSocket, host: string): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host }, () => resolve(secureSocket));
    secureSocket.once('error', reject);
  });
}

function smtpCommand(socket: SmtpSocket, command: string, expected = [250]): Promise<{ code: number; text: string }> {
  socket.write(`${command}\r\n`);
  return readSmtpResponse(socket, expected);
}

function readSmtpResponse(socket: SmtpSocket, expected = [220, 221, 235, 250, 334, 354]): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1);
      const match = last?.match(/^(\d{3})\s/);
      if (!match) return;
      cleanup();
      const code = Number(match[1]);
      if (!expected.includes(code)) {
        reject(new Error(`SMTP ${code}: ${buffer.trim()}`));
        return;
      }
      resolve({ code, text: buffer });
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

function localHostname(): string {
  return process.env.EMAIL_SMTP_HELO_HOST ?? 'asi.local';
}

function formatMessageIdHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return '<unknown@asi.local>';
  if (clean.includes('<')) return clean;
  return `<${normalizeMessageId(clean)}>`;
}
