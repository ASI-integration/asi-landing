/**
 * Provider-agnostic phone channel adapter.
 *
 * Phone Phase 1 is call intake and operator escalation only. The adapter
 * normalizes generic telephony webhook payloads and exposes transcript text
 * to the shared communication orchestrator when a provider supplies it.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { ChannelAdapter } from './base';
import { CommunicationChannel, InboundMessageEnvelope } from '../types';

export type PhoneCallEventType =
  | 'call_started'
  | 'call_missed'
  | 'call_answered'
  | 'call_ended'
  | 'call_transcribed'
  | 'call_escalated_to_operator';

export type PhoneCallStatus =
  | 'started'
  | 'missed'
  | 'answered'
  | 'ended'
  | 'transcribed'
  | 'escalated'
  | 'unknown';

export type PhoneWebhookPayload = Record<string, unknown>;

export interface NormalizedPhoneCallEvent {
  channel: 'phone';
  provider: string;
  eventType: PhoneCallEventType;
  providerCallId: string;
  callerPhoneNumber?: string;
  calledNumber?: string;
  timestamp: Date;
  callStatus: PhoneCallStatus;
  durationSeconds?: number;
  recordingUrl?: string;
  transcriptText?: string;
  providerMetadata: Record<string, unknown>;
  idempotencyKey: string;
  update_id: number;
}

export type PhoneWebhookNormalizationResult =
  | { supported: true; event: NormalizedPhoneCallEvent }
  | { supported: false; reason: 'empty_payload' | 'unsupported_event' | 'missing_call_identity'; metadata?: Record<string, unknown> };

const SECRET_HEADER_NAMES = [
  'x-phone-webhook-secret',
  'x-webhook-secret',
  'x-asi-phone-secret',
  'x-telephony-webhook-secret',
];

const SECRET_QUERY_NAMES = ['secret', 'webhook_secret', 'phone_webhook_secret'];

export class PhoneAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'phone';

  async normalizeInbound(rawPayload: unknown): Promise<InboundMessageEnvelope> {
    const normalized = isNormalizedPhoneCallEvent(rawPayload)
      ? rawPayload
      : normalizePhoneWebhookPayload(rawPayload);

    const event = isNormalizedPhoneCallEvent(normalized)
      ? normalized
      : normalized.supported
        ? normalized.event
        : null;

    if (!event) {
      throw new Error('[PhoneAdapter] normalizeInbound: unsupported phone payload');
    }

    const providerMessageId = event.idempotencyKey;
    const transcript = event.transcriptText?.trim();

    return {
      channel: 'phone',
      externalUserId: event.callerPhoneNumber ?? event.providerCallId,
      phoneNumber: event.callerPhoneNumber,
      messageText: transcript || undefined,
      receivedAt: event.timestamp,
      update_id: event.update_id,
      metadata: {
        provider: event.provider,
        providerMessageId,
        externalMessageId: providerMessageId,
        message_id: providerMessageId,
        phone: {
          provider: event.provider,
          providerCallId: event.providerCallId,
          callerPhoneNumber: event.callerPhoneNumber ?? null,
          calledNumber: event.calledNumber ?? null,
          eventType: event.eventType,
          callStatus: event.callStatus,
          durationSeconds: event.durationSeconds ?? null,
          recordingUrl: event.recordingUrl ?? null,
          transcriptText: transcript ?? null,
        },
        phone_event_type: event.eventType,
        phone_call_status: event.callStatus,
        provider_call_id: event.providerCallId,
        caller_phone_number: event.callerPhoneNumber ?? null,
        called_number: event.calledNumber ?? null,
        duration_seconds: event.durationSeconds ?? null,
        recording_url: event.recordingUrl ?? null,
        provider_metadata: event.providerMetadata,
      },
    };
  }

  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    console.log('[PhoneAdapter] Phase 1 outbound is operator-facing only', {
      to,
      contentPreview: content.slice(0, 120),
      provider: metadata?.provider ?? process.env.PHONE_PROVIDER ?? 'generic',
    });
    return true;
  }

  formatResponse(rawMessage: string, _context: Record<string, unknown>): string {
    return `[Call Follow-up / Operator Notes]\n${rawMessage.trim()}`;
  }
}

export function verifyPhoneWebhookSecret(headers: Headers, requestUrl?: string): boolean {
  const expected = String(process.env.PHONE_WEBHOOK_SECRET ?? '').trim();
  if (!expected) return true;

  const candidates: string[] = [];
  for (const header of SECRET_HEADER_NAMES) {
    const value = headers.get(header);
    if (value) candidates.push(value);
  }

  const auth = headers.get('authorization');
  if (auth) {
    candidates.push(auth);
    const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (bearer) candidates.push(bearer);
  }

  if (requestUrl) {
    try {
      const url = new URL(requestUrl);
      for (const key of SECRET_QUERY_NAMES) {
        const value = url.searchParams.get(key);
        if (value) candidates.push(value);
      }
    } catch {
      // Ignore malformed URL input.
    }
  }

  return candidates.some((candidate) => constantTimeEqual(candidate, expected));
}

export function normalizePhoneWebhookPayload(rawPayload: unknown): PhoneWebhookNormalizationResult {
  if (!isRecord(rawPayload) || Object.keys(rawPayload).length === 0) {
    return { supported: false, reason: 'empty_payload' };
  }

  const provider = (
    firstString(rawPayload, [
      'provider',
      'provider_name',
      'providerName',
      'vendor',
      'source',
    ]) ?? String(process.env.PHONE_PROVIDER ?? 'generic').trim()
  ) || 'generic';

  const providerCallId =
    firstString(rawPayload, [
      'providerCallId',
      'provider_call_id',
      'callId',
      'call_id',
      'CallSid',
      'callSid',
      'sid',
      'uuid',
      'entry_id',
      'id',
      'call.id',
      'data.call_id',
      'data.callId',
    ]) ?? '';

  const callerPhoneNumber = normalizePhoneNumber(
    firstString(rawPayload, [
      'callerPhoneNumber',
      'caller_phone_number',
      'caller',
      'caller_id',
      'callerId',
      'from',
      'From',
      'src',
      'source_number',
      'phone',
      'phone_number',
      'call.from',
      'data.from',
      'data.caller',
    ]),
  );

  const calledNumber = normalizePhoneNumber(
    firstString(rawPayload, [
      'calledNumber',
      'called_number',
      'to',
      'To',
      'dst',
      'destination',
      'destination_number',
      'did',
      'called_did',
      'support_number',
      'call.to',
      'data.to',
      'data.called',
    ]),
  );

  const transcriptText = normalizeOptionalText(
    firstString(rawPayload, [
      'transcriptText',
      'transcript_text',
      'transcript',
      'transcription',
      'TranscriptionText',
      'speech_result',
      'speechResult',
      'call.transcript',
      'call.transcription.text',
      'data.transcript',
      'data.transcription',
    ]),
  );

  const rawEvent = firstString(rawPayload, [
    'eventType',
    'event_type',
    'event',
    'type',
    'status',
    'callStatus',
    'call_status',
    'CallStatus',
    'disposition',
    'call.status',
    'data.event',
    'data.status',
  ]);

  const eventType = normalizePhoneEventType(rawEvent, transcriptText);
  if (!eventType) {
    return { supported: false, reason: 'unsupported_event', metadata: sanitizeMetadata(rawPayload) };
  }

  const fallbackCallId = providerCallId || stablePhoneFallbackId(rawPayload);
  if (!fallbackCallId && !callerPhoneNumber) {
    return { supported: false, reason: 'missing_call_identity', metadata: sanitizeMetadata(rawPayload) };
  }

  const timestamp = parsePhoneTimestamp(
    firstValue(rawPayload, [
      'timestamp',
      'ts',
      'time',
      'date',
      'created_at',
      'createdAt',
      'started_at',
      'startedAt',
      'start_time',
      'CallTimestamp',
      'call.timestamp',
      'data.timestamp',
    ]),
  );
  const durationSeconds = normalizeDurationSeconds(
    firstValue(rawPayload, [
      'durationSeconds',
      'duration_seconds',
      'duration',
      'call_duration',
      'CallDuration',
      'billsec',
      'call.duration',
      'data.duration',
    ]),
  );
  const recordingUrl = normalizeUrl(
    firstString(rawPayload, [
      'recordingUrl',
      'recording_url',
      'recording',
      'RecordingUrl',
      'recording.url',
      'call.recording_url',
      'data.recording_url',
    ]),
  );

  const callStatus = statusForEvent(eventType);
  const idempotencyKey = stablePhoneIdempotencyKey({
    provider,
    providerCallId: fallbackCallId,
    eventType,
    timestamp,
    transcriptText,
    recordingUrl,
  });

  return {
    supported: true,
    event: {
      channel: 'phone',
      provider,
      eventType,
      providerCallId: fallbackCallId,
      callerPhoneNumber,
      calledNumber,
      timestamp,
      callStatus,
      durationSeconds,
      recordingUrl,
      transcriptText,
      providerMetadata: sanitizeMetadata(rawPayload),
      idempotencyKey,
      update_id: stablePositiveInt(idempotencyKey),
    },
  };
}

export function phoneWebhookHasTranscript(payload: unknown): boolean {
  const normalized = normalizePhoneWebhookPayload(payload);
  return normalized.supported && Boolean(normalized.event.transcriptText?.trim());
}

function isNormalizedPhoneCallEvent(value: unknown): value is NormalizedPhoneCallEvent {
  return (
    isRecord(value) &&
    value.channel === 'phone' &&
    typeof value.provider === 'string' &&
    typeof value.providerCallId === 'string' &&
    typeof value.eventType === 'string' &&
    value.timestamp instanceof Date
  );
}

function normalizePhoneEventType(rawEvent: string | undefined, transcriptText?: string): PhoneCallEventType | null {
  const raw = normalizeToken(rawEvent);
  if (!raw && transcriptText) return 'call_transcribed';
  if (!raw) return null;

  if ([
    'call_started',
    'started',
    'start',
    'ringing',
    'incoming',
    'initiated',
    'call_initiated',
    'new_call',
  ].includes(raw)) return 'call_started';

  if ([
    'call_missed',
    'missed',
    'missed_call',
    'no_answer',
    'noanswer',
    'busy',
    'failed',
    'not_answered',
    'not_answer',
  ].includes(raw)) return 'call_missed';

  if ([
    'call_answered',
    'answered',
    'answer',
    'in_progress',
    'connected',
    'accepted',
    'bridged',
  ].includes(raw)) return 'call_answered';

  if ([
    'call_ended',
    'ended',
    'end',
    'completed',
    'complete',
    'hangup',
    'hang_up',
    'finished',
    'finish',
    'disconnected',
  ].includes(raw)) return 'call_ended';

  if ([
    'call_transcribed',
    'transcribed',
    'transcription',
    'transcription_completed',
    'transcript',
    'voice_transcribed',
  ].includes(raw)) return 'call_transcribed';

  if ([
    'call_escalated_to_operator',
    'escalated',
    'operator',
    'operator_escalation',
    'forwarded',
    'forwarded_to_operator',
    'transferred',
  ].includes(raw)) return 'call_escalated_to_operator';

  return null;
}

function statusForEvent(eventType: PhoneCallEventType): PhoneCallStatus {
  if (eventType === 'call_started') return 'started';
  if (eventType === 'call_missed') return 'missed';
  if (eventType === 'call_answered') return 'answered';
  if (eventType === 'call_ended') return 'ended';
  if (eventType === 'call_transcribed') return 'transcribed';
  if (eventType === 'call_escalated_to_operator') return 'escalated';
  return 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstValue(payload: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    const value = readPath(payload, path);
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return undefined;
}

function firstString(payload: Record<string, unknown>, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = readPath(payload, path);
    if (value === undefined || value === null || typeof value === 'object') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

function readPath(payload: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = payload;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function normalizePhoneNumber(value: string | undefined): string | undefined {
  const text = String(value ?? '').replace(/[^\d+]/g, '').trim();
  return text || undefined;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function normalizeUrl(value: string | undefined): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  if (/^https?:\/\//i.test(text)) return text;
  return undefined;
}

function normalizeDurationSeconds(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

function parsePhoneTimestamp(value: unknown): Date {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))) {
    const n = Number(value);
    const ms = n > 10_000_000_000 ? n : n * 1000;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  return new Date();
}

function normalizeToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.\s-]+/g, '_');
}

function stablePhoneFallbackId(payload: Record<string, unknown>): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(sanitizeMetadata(payload)))
    .digest('hex')
    .slice(0, 24);
  return `phone:${hash}`;
}

function stablePhoneIdempotencyKey(params: {
  provider: string;
  providerCallId: string;
  eventType: PhoneCallEventType;
  timestamp: Date;
  transcriptText?: string;
  recordingUrl?: string;
}): string {
  const basis = [
    params.provider,
    params.providerCallId,
    params.eventType,
    params.timestamp.toISOString(),
    params.transcriptText ? createHash('sha256').update(params.transcriptText).digest('hex').slice(0, 16) : '',
    params.recordingUrl ?? '',
  ].join('|');
  return `phone:${createHash('sha256').update(basis).digest('hex')}`;
}

function stablePositiveInt(value: string): number {
  const hash = createHash('sha256').update(value).digest();
  const n = hash.readUInt32BE(0);
  return n === 0 ? 1 : n;
}

function sanitizeMetadata(value: unknown, depth = 0): Record<string, unknown> {
  if (!isRecord(value) || depth > 3) return {};
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/secret|token|password|authorization|signature/i.test(key)) continue;
    if (Array.isArray(item)) {
      out[key] = item.slice(0, 20).map((entry) => sanitizeValue(entry, depth + 1));
    } else {
      out[key] = sanitizeValue(item, depth + 1);
    }
  }
  return out;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (isRecord(value)) return sanitizeMetadata(value, depth);
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitizeValue(entry, depth + 1));
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 1997)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return String(value ?? '');
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
