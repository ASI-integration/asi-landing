import type { TelegramUpdate } from '../types';

type BaseArgs = {
  update_id?: number;
  message_id?: number;
  chat_id: number;
  language_code?: string;
};

function baseUpdate(args: BaseArgs): TelegramUpdate {
  const update_id = args.update_id ?? Date.now();
  const message_id = args.message_id ?? update_id;
  return {
    update_id,
    message: {
      message_id,
      chat: { id: args.chat_id },
      from: args.language_code ? { language_code: args.language_code } : undefined,
    },
  };
}

export function tgTextUpdate(args: BaseArgs & { text: string }): TelegramUpdate {
  const u = baseUpdate(args);
  u.message!.text = args.text;
  return u;
}

export function tgVoiceUpdate(args: BaseArgs & { file_id?: string; duration?: number }): TelegramUpdate {
  const u = baseUpdate(args);
  // Voice/audio fields are consumed by the orchestrator but not fully modeled in types.ts.
  (u.message as any).voice = {
    file_id: args.file_id ?? `voice_${u.update_id}`,
    duration: args.duration ?? 3,
    mime_type: 'audio/ogg',
  };
  return u;
}

export function tgAudioUpdate(args: BaseArgs & { file_id?: string; duration?: number; title?: string }): TelegramUpdate {
  const u = baseUpdate(args);
  (u.message as any).audio = {
    file_id: args.file_id ?? `audio_${u.update_id}`,
    duration: args.duration ?? 12,
    title: args.title ?? 'Test audio',
    mime_type: 'audio/mpeg',
  };
  return u;
}

export async function postTelegramUpdate(params: {
  baseUrl: string; // e.g. http://localhost:3000
  update: TelegramUpdate;
  webhookSecret?: string;
}): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const res = await fetch(`${params.baseUrl.replace(/\/$/, '')}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(params.webhookSecret ? { 'x-telegram-bot-api-secret-token': params.webhookSecret } : {}),
    },
    body: JSON.stringify(params.update),
  });
  return { ok: res.ok, status: res.status, bodyText: await res.text() };
}

