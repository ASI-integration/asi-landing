import type { WhatsAppAudioMessage, WhatsAppInboundMessage, WhatsAppWebhook } from './types';

function firstMessage(webhook: WhatsAppWebhook): {
  msg: WhatsAppInboundMessage | null;
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  profileName?: string;
} {
  const entry = webhook?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const msg = value?.messages?.[0] ?? null;
  const phoneNumberId = value?.metadata?.phone_number_id;
  const displayPhoneNumber = value?.metadata?.display_phone_number;
  const profileName = value?.contacts?.[0]?.profile?.name;
  return { msg, phoneNumberId, displayPhoneNumber, profileName };
}

export function extractInboundAudioMessage(webhook: WhatsAppWebhook): WhatsAppAudioMessage | null {
  const { msg, phoneNumberId, displayPhoneNumber, profileName } = firstMessage(webhook);
  if (!msg) return null;

  const waId = String(msg.from ?? '').trim();
  const messageId = String(msg.id ?? '').trim();
  const type = String(msg.type ?? '').trim();
  const mediaId = String(msg.audio?.id ?? '').trim();

  const isAudio = type === 'audio' || type === 'voice';
  if (!isAudio) return null;
  if (!waId || !messageId || !mediaId) return null;

  return {
    waId,
    messageId,
    mediaId,
    mimeType: msg.audio?.mime_type,
    timestamp: msg.timestamp,
    phoneNumberId,
    displayPhoneNumber,
    profileName,
    rawMessage: msg,
    rawWebhook: webhook,
  };
}

