import { importBookingFromText } from '@/lib/bookings/import-service';
import type { PropertyLookup } from '@/lib/bookings/text-import';
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
  const message = text(input.envelope.messageText);
  if (!looksLikeBookingText(message)) {
    return { handled: false, replyText: '', bookingId: null };
  }

  const properties =
    input.knownProperties
    ?? propertiesFromOwnerSession(input.chatId, input.envelope.channel);

  const imported = await importBookingFromText({
    text: message,
    properties,
    forceCreate: false,
  });

  if (imported.needsReview) {
    return {
      handled: true,
      replyText: `Не хватает: ${imported.candidate.missingFields.join(', ') || 'данных'}. Передала на проверку.`,
      bookingId: null,
    };
  }

  if (!imported.ok) {
    return {
      handled: true,
      replyText: 'Не удалось создать бронь. Передала на проверку.',
      bookingId: null,
    };
  }

  return {
    handled: true,
    replyText: 'Поняла бронь. Создала задачи заезда, выезда и уборки.',
    bookingId: imported.bookingId,
  };
}
