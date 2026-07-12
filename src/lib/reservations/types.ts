export const reservationSourceTypes = ['channel_manager','ota','direct_website','phone','telegram','email','walk_in','manual','owner_block','maintenance_block'] as const;
export type ReservationSourceType = typeof reservationSourceTypes[number];
export type ConfirmationMode = 'inquiry' | 'temporary_hold' | 'confirmed';
export type ReservationStatus = ConfirmationMode | 'checked_in' | 'checked_out' | 'cancelled';
export type DirectReservationInput = {
  accountId: string; actorId: string; idempotencyKey: string; propertyId: string; unitId?: string | null;
  checkIn: string; checkOut: string; guestName: string; guestPhone?: string | null; guestEmail?: string | null;
  guestTelegram?: string | null; guestCount: number; sourceType: ReservationSourceType; sourceProvider?: string | null;
  externalReservationId?: string | null; originalChannel?: string | null; bookingReference?: string | null;
  amount?: number | null; currency?: string | null; paymentStatus?: string | null; depositStatus?: string | null;
  notes?: string | null; confirmationMode: ConfirmationMode; holdExpiresAt?: string | null; metadata?: Record<string, unknown>;
};
export type SafeAvailabilityConflict = { kind: 'reservation' | 'hold' | 'block'; id: string; reference: string; dateFrom: string; dateTo: string };
