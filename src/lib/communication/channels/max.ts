/**
 * MAX channel adapter.
 *
 * MAX is transport-only. Inbound webhooks are normalized into the shared
 * communication envelope and then processed by the canonical communication core.
 */

import { createHash } from 'node:crypto';
import { ChannelAdapter } from './base';
import { CommunicationChannel, InboundMessageEnvelope } from '../types';
import type { VoiceResponseDecision } from '../voice-response-policy';
import { estimateVoiceSeconds } from '../voice-response-policy';
import { recordVoiceBudgetUsage } from '../voice-budget-store';
import { generateSpeech } from '../voice-tts';
import {
  normalizeSpeechTextForNativeAudio,
  normalizeSpeechTextForTts,
} from '../voice-speech-normalization';
import { generateGeminiNativeSpeech, isGeminiNativeAudioEnabled } from '../gemini-native-audio';
import { isVoiceReplyGloballyEnabled } from '../voice-reply';

const DEFAULT_MAX_API_BASE_URL = 'https://platform-api2.max.ru';
const MAX_AUDIO_UPLOAD_HOST = 'vu.okcdn.ru';

export interface MaxWebhookAttachment {
  type?: string;
  payload?: {
    url?: string;
    file_url?: string;
    download_url?: string;
    token?: string;
    [key: string]: unknown;
  } | null;
  url?: string;
  duration?: number;
  [key: string]: unknown;
}

export interface MaxWebhookPayload {
  update_type?: string;
  type?: string;
  event_type?: string;
  event_id?: string | number;
  update_id?: string | number;
  timestamp?: string | number;
  user_id?: string | number;
  chat_id?: string | number;
  user?: { user_id?: string | number; id?: string | number } | null;
  chat?: { chat_id?: string | number; id?: string | number } | null;
  message?: MaxWebhookMessage | null;
  object?: {
    message?: MaxWebhookMessage | null;
  } | null;
}

export interface MaxWebhookMessage {
  id?: string | number;
  message_id?: string | number;
  timestamp?: string | number;
  created_at?: string | number;
  text?: string;
  body?: {
    mid?: string | number;
    text?: string;
    attachments?: MaxWebhookAttachment[] | null;
  } | null;
  user_id?: string | number;
  chat_id?: string | number;
  sender?: {
    user_id?: string | number;
    id?: string | number;
  } | null;
  chat?: {
    chat_id?: string | number;
    id?: string | number;
  } | null;
  recipient?: {
    chat_id?: string | number;
    user_id?: string | number;
  } | null;
}

type MaxTarget = { chatId: string | null; userId: string | null };

type MaxVoiceGenerationResult = {
  audio: ArrayBuffer | null;
  provider: string;
  format: string;
  errorType?: string;
  fallbackUsed?: boolean;
};

export class MaxAdapter implements ChannelAdapter {
  channel: CommunicationChannel = 'max';

  async normalizeInbound(rawPayload: MaxWebhookPayload): Promise<InboundMessageEnvelope> {
    const message = rawPayload.message ?? rawPayload.object?.message ?? null;
    if (!message) throw new Error('[MaxAdapter] normalizeInbound: no message in payload');

    const text = extractMaxText(message);
    const userId = normalizeMaxId(
      message.sender?.user_id ??
        message.sender?.id ??
        message.user_id ??
        rawPayload.user?.user_id ??
        rawPayload.user?.id ??
        rawPayload.user_id ??
        message.recipient?.user_id,
    );
    const chatId = normalizeMaxId(
      message.chat_id ??
        message.chat?.chat_id ??
        message.chat?.id ??
        message.recipient?.chat_id ??
        rawPayload.chat?.chat_id ??
        rawPayload.chat?.id ??
        rawPayload.chat_id,
    );
    const providerMessageId = stableMaxProviderMessageId(rawPayload, message, userId, chatId, text);
    const updateType = normalizeMaxId(rawPayload.update_type ?? rawPayload.type ?? rawPayload.event_type) ?? 'unknown';
    const sourceMessageId = normalizeMaxId(message.body?.mid ?? message.id ?? message.message_id);

    return {
      channel: 'max',
      externalUserId: userId ?? chatId ?? providerMessageId,
      chatId: chatId ?? undefined,
      messageText: text,
      receivedAt: parseMaxTimestamp(message.timestamp ?? message.created_at ?? rawPayload.timestamp),
      update_id: stablePositiveInt(providerMessageId),
      metadata: {
        provider: 'max',
        providerMessageId,
        externalMessageId: providerMessageId,
        message_id: sourceMessageId ?? providerMessageId,
        max_message_id: sourceMessageId ?? null,
        max_event_id: normalizeMaxId(rawPayload.event_id ?? rawPayload.update_id) ?? null,
        update_type: updateType,
        user_id: userId ?? null,
        chat_id: chatId ?? null,
      },
    };
  }

  async sendMessage(to: string, content: string, metadata?: Record<string, unknown>): Promise<boolean> {
    const token = getMaxBotToken();
    if (!token) {
      console.error('[MaxAdapter] MAX_BOT_TOKEN is not configured');
      return false;
    }

    const target = resolveMaxTarget(to, metadata);
    if (!target.chatId && !target.userId) {
      console.error('[MaxAdapter] no MAX user_id or chat_id target');
      return false;
    }

    const decision = readVoiceDecision(metadata);
    if (isVoiceReplyGloballyEnabled() && decision?.shouldSendVoice) {
      const voiceSent = await sendMaxVoiceReply(target, decision, token);
      if (voiceSent) {
        const companionText = String(decision.companionText ?? '').trim();
        if (!companionText) return true;
        const companionSent = await sendMaxText(target, companionText, token);
        if (companionSent) return true;
        console.warn('[max:voice] companion_text_fallback');
      } else {
        console.warn('[max:voice] text_fallback', { reason: decision.reason });
      }
    }

    return sendMaxText(target, content, token);
  }

  formatResponse(rawMessage: string, _context: Record<string, unknown>): string {
    return limitMaxText(rawMessage.trim());
  }
}

export function verifyMaxWebhookSecret(headerSecret: string | null | undefined): boolean {
  const expected = process.env.MAX_WEBHOOK_SECRET;
  if (!expected) return true;
  return String(headerSecret ?? '') === expected;
}

export function maxWebhookEventType(payload: MaxWebhookPayload): string {
  return String(payload.update_type ?? payload.type ?? payload.event_type ?? '').trim();
}

export function maxWebhookText(payload: MaxWebhookPayload): string {
  const message = payload.message ?? payload.object?.message ?? null;
  return message ? extractMaxText(message) : '';
}

export function maxWebhookAudioAttachment(payload: MaxWebhookPayload): MaxWebhookAttachment | null {
  const message = payload.message ?? payload.object?.message ?? null;
  const attachments = Array.isArray(message?.body?.attachments) ? message?.body?.attachments : [];
  return attachments.find((attachment) => String(attachment?.type ?? '').trim().toLowerCase() === 'audio') ?? null;
}

export function maxWebhookHasProcessableMessage(payload: MaxWebhookPayload): boolean {
  return Boolean(maxWebhookText(payload) || maxWebhookAudioAttachment(payload));
}

export function maxAttachmentAudioUrl(attachment: MaxWebhookAttachment | null | undefined): string | null {
  const raw =
    attachment?.payload?.url ??
    attachment?.payload?.file_url ??
    attachment?.payload?.download_url ??
    attachment?.url;
  const value = String(raw ?? '').trim();
  return value || null;
}

export function isAllowedMaxAudioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return (
      host === MAX_AUDIO_UPLOAD_HOST ||
      host.endsWith('.okcdn.ru') ||
      host === 'oneme.ru' ||
      host.endsWith('.oneme.ru') ||
      host === 'max.ru' ||
      host.endsWith('.max.ru')
    );
  } catch {
    return false;
  }
}

function extractMaxText(message: MaxWebhookMessage): string {
  return String(message.body?.text ?? message.text ?? '').trim();
}

function getMaxBotToken(): string | null {
  const value = String(process.env.MAX_BOT_TOKEN ?? '').trim();
  return value || null;
}

function getMaxApiBaseUrl(): string {
  return String(process.env.MAX_API_BASE_URL ?? DEFAULT_MAX_API_BASE_URL).trim().replace(/\/$/, '');
}

function resolveMaxTarget(to: string, metadata?: Record<string, unknown>): MaxTarget {
  const chatId = normalizeMaxId(metadata?.chat_id ?? metadata?.max_chat_id);
  const userId = normalizeMaxId(metadata?.user_id ?? metadata?.max_user_id ?? (chatId ? null : to));
  return { chatId, userId };
}

function targetUrl(path: string, target: MaxTarget): URL {
  const url = new URL(path, `${getMaxApiBaseUrl()}/`);
  if (target.chatId) url.searchParams.set('chat_id', target.chatId);
  else if (target.userId) url.searchParams.set('user_id', target.userId);
  return url;
}

async function sendMaxText(target: MaxTarget, content: string, token: string): Promise<boolean> {
  const text = limitMaxText(content);
  if (!text) return false;
  return sendMaxMessageBody(target, { text }, token);
}

async function sendMaxMessageBody(
  target: MaxTarget,
  body: Record<string, unknown>,
  token: string,
): Promise<boolean> {
  const url = targetUrl('/messages', target);
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const responseText = await res.text().catch(() => '');
      console.error('[MaxAdapter] API error', {
        status: res.status,
        statusText: res.statusText,
        code: safeMaxApiErrorCode(responseText),
      });
      return false;
    }
    return true;
  } catch (error) {
    console.error('[MaxAdapter] sendMessage failed', { error_type: (error as Error).name || 'network' });
    return false;
  }
}

function readVoiceDecision(metadata?: Record<string, unknown>): VoiceResponseDecision | null {
  const raw = metadata?.voice_response_decision;
  if (!raw || typeof raw !== 'object') return null;
  return raw as VoiceResponseDecision;
}

async function generateMaxVoiceAudio(voiceText: string): Promise<MaxVoiceGenerationResult> {
  if (isGeminiNativeAudioEnabled()) {
    const native = await generateGeminiNativeSpeech(normalizeSpeechTextForNativeAudio(voiceText));
    if (native.audio) return { ...native, fallbackUsed: false };
    console.warn('[max:voice] native_audio.provider_fail', {
      provider: native.provider,
      error_type: native.errorType ?? 'unknown',
    });
    const fallback = await generateSpeech(normalizeSpeechTextForTts(voiceText));
    return { ...fallback, fallbackUsed: Boolean(fallback.audio) };
  }
  return await generateSpeech(normalizeSpeechTextForTts(voiceText));
}

function audioFilename(format: string): string {
  const normalized = String(format ?? '').trim().toLowerCase();
  if (normalized.includes('wav')) return 'reply.wav';
  if (normalized.includes('m4a') || normalized.includes('mp4')) return 'reply.m4a';
  if (normalized.includes('ogg') || normalized.includes('opus')) return 'reply.ogg';
  return 'reply.mp3';
}

function audioMimeType(format: string): string {
  const normalized = String(format ?? '').trim().toLowerCase();
  if (normalized.includes('wav')) return 'audio/wav';
  if (normalized.includes('m4a') || normalized.includes('mp4')) return 'audio/mp4';
  if (normalized.includes('ogg') || normalized.includes('opus')) return 'audio/ogg';
  return 'audio/mpeg';
}

async function uploadMaxAudio(
  audio: ArrayBuffer,
  format: string,
  token: string,
): Promise<string | null> {
  const prepareUrl = new URL('/uploads', `${getMaxApiBaseUrl()}/`);
  prepareUrl.searchParams.set('type', 'audio');

  try {
    const prepare = await fetch(prepareUrl.toString(), {
      method: 'POST',
      headers: { Authorization: token },
    });
    if (!prepare.ok) {
      console.error('[max:voice] upload_prepare_fail', { status: prepare.status });
      return null;
    }
    const prepared = (await prepare.json().catch(() => ({}))) as { url?: string; token?: string };
    const uploadUrl = String(prepared.url ?? '').trim();
    if (!uploadUrl || !isAllowedMaxAudioUrl(uploadUrl)) {
      console.error('[max:voice] upload_prepare_invalid_url');
      return null;
    }

    const blob = new Blob([new Uint8Array(audio)], { type: audioMimeType(format) });
    const form = new FormData();
    form.append('data', blob, audioFilename(format));
    const uploaded = await fetch(uploadUrl, { method: 'POST', body: form });
    if (!uploaded.ok) {
      console.error('[max:voice] upload_fail', { status: uploaded.status });
      return null;
    }
    const uploadResult = (await uploaded.json().catch(() => ({}))) as {
      token?: string;
      retval?: { token?: string } | string;
    };
    const uploadToken = String(
      prepared.token ??
        uploadResult.token ??
        (typeof uploadResult.retval === 'object' ? uploadResult.retval?.token : '') ??
        '',
    ).trim();
    return uploadToken || null;
  } catch (error) {
    console.error('[max:voice] upload_network_fail', { error_type: (error as Error).name || 'network' });
    return null;
  }
}

async function sendMaxVoiceReply(
  target: MaxTarget,
  decision: VoiceResponseDecision,
  token: string,
): Promise<boolean> {
  const voiceText = String(decision.voiceText ?? '').trim();
  if (!voiceText) return false;

  try {
    const generated = await generateMaxVoiceAudio(voiceText);
    if (!generated.audio) {
      console.warn('[max:voice] tts_fail', {
        provider: generated.provider,
        error_type: generated.errorType ?? 'unknown',
      });
      return false;
    }
    const uploadToken = await uploadMaxAudio(generated.audio, generated.format, token);
    if (!uploadToken) return false;

    const sent = await sendMaxMessageBody(
      target,
      { attachments: [{ type: 'audio', payload: { token: uploadToken } }] },
      token,
    );
    if (!sent) return false;

    const budgetChatId = Number.parseInt(target.chatId ?? target.userId ?? '', 10);
    if (Number.isFinite(budgetChatId)) {
      recordVoiceBudgetUsage({
        chatId: budgetChatId,
        estimatedSeconds: estimateVoiceSeconds(voiceText),
      });
    }
    console.info('[max:voice] voice_reply.ok', {
      chars: voiceText.length,
      provider: generated.provider,
      fallback_used: generated.fallbackUsed ?? false,
    });
    return true;
  } catch (error) {
    console.error('[max:voice] voice_reply.fail_unexpected', {
      error_type: (error as Error).name || 'unexpected',
    });
    return false;
  }
}

function safeMaxApiErrorCode(raw: string): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { code?: unknown };
    return typeof parsed.code === 'string' ? parsed.code.slice(0, 120) : null;
  } catch {
    return null;
  }
}

function normalizeMaxId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out ? out : null;
}

function stableMaxProviderMessageId(
  payload: MaxWebhookPayload,
  message: MaxWebhookMessage,
  userId: string | null,
  chatId: string | null,
  text: string,
): string {
  const eventId = normalizeMaxId(payload.event_id ?? payload.update_id);
  if (eventId) return `max:${eventId}`;
  const messageId = normalizeMaxId(message.body?.mid ?? message.id ?? message.message_id);
  const actor = chatId ?? userId ?? 'unknown';
  if (messageId) return `max:${actor}:${messageId}`;
  const basis = JSON.stringify({
    actor,
    text,
    timestamp: message.timestamp ?? message.created_at ?? payload.timestamp ?? null,
    updateType: payload.update_type ?? payload.type ?? payload.event_type ?? null,
  });
  return `max:${actor}:${createHash('sha256').update(basis).digest('hex').slice(0, 24)}`;
}

function stablePositiveInt(value: string): number {
  const hash = createHash('sha256').update(value).digest();
  const n = hash.readUInt32BE(0);
  return n === 0 ? 1 : n;
}

function parseMaxTimestamp(value: unknown): Date {
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

function limitMaxText(value: string): string {
  const text = String(value ?? '').trim();
  return text.length > 4000 ? `${text.slice(0, 3997).trim()}...` : text;
}
