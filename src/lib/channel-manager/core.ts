import type { ChannelCode, ReservationStatus, ShadowBookingEventType } from './types';

export interface InventorySnapshot {
  propertyId: string;
  unitKey: string;
  day: string;
  totalUnits: number;
  bookedUnits: number;
  manualBlockedUnits: number;
}

export interface CoreReservationInput {
  propertyId: string;
  unitKey?: string;
  channelCode?: ChannelCode;
  externalBookingId?: string;
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
  quantity?: number;
  totalAmount?: number;
  commissionPercent?: number;
  channelReliabilityLevel?: number;
  guestType?: string;
  confirmationMode?: 'confirm' | 'pending';
}

export interface CoreReservation {
  id: string;
  propertyId: string;
  unitKey: string;
  channelCode: ChannelCode;
  externalBookingId: string | null;
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
  quantity: number;
  status: ReservationStatus;
  rejectionReason: string | null;
  priorityScore: number;
  totalAmount: number | null;
  commissionPercent: number | null;
  channelReliabilityLevel: number | null;
  guestType: string | null;
}

export function enumerateNights(checkInDate: string, checkOutDate: string): string[] {
  const start = new Date(`${checkInDate}T00:00:00.000Z`);
  const end = new Date(`${checkOutDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error('invalid_dates');
  }

  const nights: string[] = [];
  for (let cur = start; cur < end; cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000)) {
    nights.push(cur.toISOString().slice(0, 10));
  }
  return nights;
}

export function availableUnits(day: InventorySnapshot): number {
  return Math.max(day.totalUnits - day.bookedUnits - day.manualBlockedUnits, 0);
}

export function calculateReservationPriority(input: {
  nightsCount: number;
  totalAmount?: number | null;
  commissionPercent?: number | null;
  channelReliabilityLevel?: number | null;
}): number {
  const nightsScore = input.nightsCount * 100;
  const amountScore = Math.max(input.totalAmount ?? 0, 0) / 100;
  const commissionPenalty = Math.max(input.commissionPercent ?? 0, 0) * 2;
  const reliabilityScore = Math.max(input.channelReliabilityLevel ?? 0, 0);
  return Math.round((nightsScore + amountScore + reliabilityScore - commissionPenalty) * 100) / 100;
}

export function calculateShadowAvailabilityProjection(input: {
  eventType: ShadowBookingEventType;
  nights: string[];
  availableByDay: Record<string, number>;
  quantity: number;
}): { available: boolean; projectedAvailability: Record<string, number> } {
  const quantity = Math.max(Math.trunc(input.quantity), 0);
  const available = input.eventType === 'reservation_cancelled'
    ? true
    : input.nights.every((day) => Math.max(input.availableByDay[day] ?? 0, 0) >= quantity);
  const projectedAvailability = Object.fromEntries(
    input.nights.map((day) => {
      const current = Math.max(input.availableByDay[day] ?? 0, 0);
      if (input.eventType === 'reservation_cancelled') return [day, current + quantity];
      return [day, Math.max(current - quantity, 0)];
    }),
  );
  return { available, projectedAvailability };
}

export class InMemoryChannelManagerCore {
  private inventory = new Map<string, InventorySnapshot>();
  private reservations = new Map<string, CoreReservation>();
  private externalIndex = new Map<string, string>();
  private syncJobs = 0;
  private locked = Promise.resolve();
  private seq = 0;

  setInventory(day: InventorySnapshot): number {
    const key = this.inventoryKey(day.propertyId, day.unitKey, day.day);
    this.inventory.set(key, { ...day });
    this.syncJobs += 1;
    return this.syncJobs;
  }

  getInventory(propertyId: string, unitKey: string, day: string): InventorySnapshot | undefined {
    return this.inventory.get(this.inventoryKey(propertyId, unitKey, day));
  }

  getReservation(id: string): CoreReservation | undefined {
    const reservation = this.reservations.get(id);
    return reservation ? { ...reservation } : undefined;
  }

  getSyncJobCount(): number {
    return this.syncJobs;
  }

  async createReservation(input: CoreReservationInput): Promise<{
    reservation: CoreReservation;
    available: boolean;
    idempotent: boolean;
  }> {
    return this.withLock(async () => {
      const unitKey = input.unitKey || 'default';
      const channelCode = input.channelCode || 'manual';
      const quantity = input.quantity ?? 1;
      const confirmationMode = input.confirmationMode ?? 'confirm';
      const externalKey = input.externalBookingId
        ? `${input.propertyId}:${channelCode}:${input.externalBookingId}`
        : null;
      if (externalKey) {
        const existingId = this.externalIndex.get(externalKey);
        if (existingId) {
          const existing = this.reservations.get(existingId);
          if (existing) return { reservation: { ...existing }, available: existing.status === 'confirmed', idempotent: true };
        }
      }

      const nights = enumerateNights(input.checkInDate, input.checkOutDate);
      const priorityScore = calculateReservationPriority({
        nightsCount: nights.length,
        totalAmount: input.totalAmount,
        commissionPercent: input.commissionPercent,
        channelReliabilityLevel: input.channelReliabilityLevel,
      });
      const canBook = nights.every((day) => {
        const row = this.inventory.get(this.inventoryKey(input.propertyId, unitKey, day));
        return row ? availableUnits(row) >= quantity : false;
      });
      const shouldHoldInventory = canBook && confirmationMode === 'confirm';

      const reservation: CoreReservation = {
        id: `res-${++this.seq}`,
        propertyId: input.propertyId,
        unitKey,
        channelCode,
        externalBookingId: input.externalBookingId ?? null,
        guestName: input.guestName,
        checkInDate: input.checkInDate,
        checkOutDate: input.checkOutDate,
        quantity,
        status: shouldHoldInventory ? 'confirmed' : canBook ? 'pending' : 'conflict',
        rejectionReason: canBook ? null : 'no_availability',
        priorityScore,
        totalAmount: input.totalAmount ?? null,
        commissionPercent: input.commissionPercent ?? null,
        channelReliabilityLevel: input.channelReliabilityLevel ?? null,
        guestType: input.guestType ?? null,
      };

      this.reservations.set(reservation.id, reservation);
      if (externalKey) this.externalIndex.set(externalKey, reservation.id);

      if (shouldHoldInventory) {
        for (const day of nights) {
          const key = this.inventoryKey(input.propertyId, unitKey, day);
          const row = this.inventory.get(key);
          if (row) this.inventory.set(key, { ...row, bookedUnits: row.bookedUnits + quantity });
        }
        this.syncJobs += 1;
      }

      return { reservation: { ...reservation }, available: shouldHoldInventory, idempotent: false };
    });
  }

  async cancelReservation(reservationId: string): Promise<CoreReservation> {
    return this.withLock(async () => {
      const reservation = this.reservations.get(reservationId);
      if (!reservation) throw new Error('reservation_not_found');
      if (reservation.status === 'cancelled') return { ...reservation };

      if (reservation.status === 'confirmed' || reservation.status === 'modified') {
        for (const day of enumerateNights(reservation.checkInDate, reservation.checkOutDate)) {
          const key = this.inventoryKey(reservation.propertyId, reservation.unitKey, day);
          const row = this.inventory.get(key);
          if (row) this.inventory.set(key, { ...row, bookedUnits: Math.max(row.bookedUnits - reservation.quantity, 0) });
        }
      }

      const next = { ...reservation, status: 'cancelled' as const };
      this.reservations.set(reservationId, next);
      this.syncJobs += 1;
      return { ...next };
    });
  }

  async modifyReservationDates(
    reservationId: string,
    checkInDate: string,
    checkOutDate: string,
  ): Promise<{ reservation: CoreReservation; available: boolean }> {
    return this.withLock(async () => {
      const reservation = this.reservations.get(reservationId);
      if (!reservation) throw new Error('reservation_not_found');

      const oldNights = enumerateNights(reservation.checkInDate, reservation.checkOutDate);
      if (reservation.status === 'confirmed' || reservation.status === 'modified') {
        for (const day of oldNights) {
          const key = this.inventoryKey(reservation.propertyId, reservation.unitKey, day);
          const row = this.inventory.get(key);
          if (row) this.inventory.set(key, { ...row, bookedUnits: Math.max(row.bookedUnits - reservation.quantity, 0) });
        }
      }

      const newNights = enumerateNights(checkInDate, checkOutDate);
      const canBook = newNights.every((day) => {
        const row = this.inventory.get(this.inventoryKey(reservation.propertyId, reservation.unitKey, day));
        return row ? availableUnits(row) >= reservation.quantity : false;
      });

      if (!canBook) {
        if (reservation.status === 'confirmed' || reservation.status === 'modified') {
          for (const day of oldNights) {
            const key = this.inventoryKey(reservation.propertyId, reservation.unitKey, day);
            const row = this.inventory.get(key);
            if (row) this.inventory.set(key, { ...row, bookedUnits: row.bookedUnits + reservation.quantity });
          }
        }
        return { reservation: { ...reservation }, available: false };
      }

      for (const day of newNights) {
        const key = this.inventoryKey(reservation.propertyId, reservation.unitKey, day);
        const row = this.inventory.get(key);
        if (row) this.inventory.set(key, { ...row, bookedUnits: row.bookedUnits + reservation.quantity });
      }

      const next = {
        ...reservation,
        checkInDate,
        checkOutDate,
        status: 'modified' as const,
      };
      this.reservations.set(reservationId, next);
      this.syncJobs += 1;
      return { reservation: { ...next }, available: true };
    });
  }

  private inventoryKey(propertyId: string, unitKey: string, day: string): string {
    return `${propertyId}:${unitKey}:${day}`;
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.locked;
    let release!: () => void;
    this.locked = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
