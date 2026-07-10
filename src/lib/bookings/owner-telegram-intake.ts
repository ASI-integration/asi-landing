import { processInboundBookingRequest } from '@/lib/booking-ops/real-booking-intake-autopilot';
import { parseBookingTextImport, type PropertyLookup } from '@/lib/bookings/text-import';
import { listOwnerObjectRecords } from '@/lib/communication/telegram-owner-object-session';
import type { CommunicationChannel, InboundMessageEnvelope } from '@/lib/communication/types';

const BOOKING_INTENT_RE =
  /(?:бронь|бронирован|заезд|выезд|гост[ьяюе]?|суточно|авито|check[\s-]?in|check[\s-]?out)/i;

function text(value: unknown, max = 4000): string {
  return String(value ?? '').trim().slice(0, max);
}

function looksLikeBookingText(message: string): boolean {
  const raw = text(message);
  if (!raw) return false;
  if (!BOOKING_INTENT_RE.test(raw)) return false;
  const hasDate = /\d{1,2}[./]\d{1,2}/.test(raw) || /заезд|выезд/i.test(raw);
  const hasContact = /(?:\+7|8)\s*[\d\s()-]{9,14}\d/.test(raw);
  return hasDate || hasContact || raw.length > 40;
}

function propertiesFromOwnerSession(chatId: number, channel: CommunicationChannel): PropertyLookup[] {
  const records = listOwnerObjectRecords(chatId, channel);
  return records
    .map((record) => ({
      propertyId: text(record.objectId),
      label: text(record.title) || text(record.objectId),
    }))
    .filter((item) => item.propertyId);
}

function metadataText(metadata: InboundMessageEnvelope['metadata'], keys: string[]): string | null {
  for (const key of keys) {
    const value = (metadata as Record<string, unknown> | undefined)?.[key];
    const normalized = text(value, 256);
    if (normalized) return normalized;
  }
  return null;
}

export type OwnerTelegramBookingIntakeResult = {
  handled: boolean;
  replyText: string;
  bookingId: string | null;
};

export async function tryTelegramOwnerBookingIntake(input: {
  envelope: InboundMessageEnvelope;
  chatId: number;
  knownProperties?: PropertyLookup[];
}): Promise<OwnerTelegramBookingIntakeResult> {
  const senderIdentity = metadataText(input.envelope.metadata, ['senderIdentity']);
  if (senderIdentity === 'guest' || senderIdentity === 'support_problem') {
    return { handled: false, replyText: '', bookingId: null };
  }

  const message = text(input.envelope.messageText);
  if (!looksLikeBookingText(message)) {
    return { handled: false, replyText: '', bookingId: null };
  }

  const properties =
    input.knownProperties
    ?? propertiesFromOwnerSession(input.chatId, input.envelope.channel);
  const candidate = parseBookingTextImport({
    text: message,
    properties,
  });
  const metadata = input.envelope.metadata;
  const sourceMessageId =
    metadataText(metadata, ['inboundIdempotencyKey', 'providerMessageId', 'externalMessageId'])
    ?? `${input.envelope.channel}:${input.chatId}:${message}`;
  const telegramUserId = metadataText(metadata, ['telegram_user_id']);
  const telegramUsername = metadataText(metadata, ['telegram_username']);

  const intake = await processInboundBookingRequest({
    guestName: candidate.guestName,
    guestPhone: candidate.guestContact,
    guestTelegram: telegramUsername ? `@${telegramUsername.replace(/^@/, '')}` : null,
    telegramUserId,
    telegramChatId: String(input.chatId),
    checkInAt: candidate.checkIn,
    checkOutAt: candidate.checkOut,
    propertyId: candidate.propertyId,
    propertyLabel: candidate.propertyLabel,
    bookingReference: candidate.reservationRef,
    sourceMessageId,
    rawMessageText: message,
    metadata: {
      ownerTelegramBookingSignal: true,
      channel: candidate.channel,
      confidence: candidate.confidence,
      parserMissingFields: candidate.missingFields,
      senderIdentity,
      providerMessageId: metadataText(metadata, ['providerMessageId']),
    },
  }, 'telegram');

  if (intake.intakeStatus === 'failed') {
    return {
      handled: true,
      replyText: 'Не удалось создать бронь. Передала на проверку.',
      bookingId: null,
    };
  }

  if (intake.missingRequiredFields.length > 0 || intake.intakeStatus === 'needs_review') {
    return {
      handled: true,
      replyText: `Не хватает: ${intake.missingRequiredFields.join(', ') || 'данных'}. Передала на проверку.`,
      bookingId: intake.bookingId,
    };
  }

  return {
    handled: true,
    replyText: 'Поняла бронь. Создала задачи заезда, выезда и уборки.',
    bookingId: intake.bookingId,
  };
}
