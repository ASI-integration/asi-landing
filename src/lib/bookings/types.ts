export const BOOKING_CHANNELS = [
  'manual',
  'avito',
  'ostrovok',
  'sutochno',
  'yandex_travel',
  'other',
] as const;

export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

export const BOOKING_CHANNEL_LABELS_RU: Record<BookingChannel, string> = {
  manual: 'Вручную',
  avito: 'Авито',
  ostrovok: 'Островок',
  sutochno: 'Суточно',
  yandex_travel: 'Яндекс Путешествия',
  other: 'Другое',
};

export const BOOKING_STATUSES = ['new', 'confirmed', 'cancelled', 'completed'] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS_RU: Record<BookingStatus, string> = {
  new: 'Новая',
  confirmed: 'Подтверждена',
  cancelled: 'Отменена',
  completed: 'Завершена',
};

export type PilotBooking = {
  id: string;
  reservationRef: string;
  propertyId: string;
  guestName: string | null;
  guestContact: string | null;
  checkIn: string | null;
  checkOut: string | null;
  channel: BookingChannel;
  status: BookingStatus;
  comment: string | null;
  pilotAcceptanceMarker: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatePilotBookingInput = {
  propertyId: string;
  guestName?: string | null;
  guestContact?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  channel?: BookingChannel;
  status?: BookingStatus;
  comment?: string | null;
  reservationRef?: string | null;
  pilotAcceptanceMarker?: string | null;
};

export type UpdatePilotBookingInput = Partial<CreatePilotBookingInput>;

export function normalizeBookingChannel(value: unknown): BookingChannel {
  const raw = String(value ?? '').trim().toLowerCase();
  if ((BOOKING_CHANNELS as readonly string[]).includes(raw)) {
    return raw as BookingChannel;
  }
  return 'manual';
}

export function normalizeBookingStatus(value: unknown): BookingStatus {
  const raw = String(value ?? '').trim().toLowerCase();
  if ((BOOKING_STATUSES as readonly string[]).includes(raw)) {
    return raw as BookingStatus;
  }
  return 'new';
}

export function bookingNeedsManualReview(booking: Pick<PilotBooking, 'guestName' | 'checkIn' | 'checkOut' | 'propertyId'>): boolean {
  return !String(booking.propertyId ?? '').trim()
    || !String(booking.guestName ?? '').trim()
    || !String(booking.checkIn ?? '').trim()
    || !String(booking.checkOut ?? '').trim();
}
