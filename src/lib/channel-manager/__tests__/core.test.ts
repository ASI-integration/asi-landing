import { describe, expect, it } from 'vitest';
import {
  availableUnits,
  calculateShadowAvailabilityProjection,
  enumerateNights,
  InMemoryChannelManagerCore,
} from '../core';

function seedTwoNights(manager: InMemoryChannelManagerCore, blockedUnits = 0, propertyId = 'property-1') {
  for (const day of ['2026-07-10', '2026-07-11']) {
    manager.setInventory({
      propertyId,
      unitKey: 'default',
      day,
      totalUnits: 1,
      bookedUnits: 0,
      manualBlockedUnits: blockedUnits,
    });
  }
}

describe('channel manager core', () => {
  it('builds the charged nights and excludes checkout date', () => {
    expect(enumerateNights('2026-07-10', '2026-07-13')).toEqual([
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
    ]);
  });

  it('creates a reservation on free dates and decreases availability', async () => {
    const manager = new InMemoryChannelManagerCore();
    seedTwoNights(manager);

    const result = await manager.createReservation({
      propertyId: 'property-1',
      guestName: 'Ирина',
      checkInDate: '2026-07-10',
      checkOutDate: '2026-07-12',
      externalBookingId: 'manual-1',
    });

    expect(result.available).toBe(true);
    expect(result.reservation.status).toBe('confirmed');
    expect(manager.getInventory('property-1', 'default', '2026-07-10')?.bookedUnits).toBe(1);
    expect(manager.getSyncJobCount()).toBe(3);
  });

  it('moves a second reservation to conflict when there are no units left', async () => {
    const manager = new InMemoryChannelManagerCore();
    seedTwoNights(manager);

    await manager.createReservation({
      propertyId: 'property-1',
      guestName: 'Ирина',
      checkInDate: '2026-07-10',
      checkOutDate: '2026-07-12',
    });
    const second = await manager.createReservation({
      propertyId: 'property-1',
      guestName: 'Олег',
      checkInDate: '2026-07-10',
      checkOutDate: '2026-07-12',
    });

    expect(second.available).toBe(false);
    expect(second.reservation.status).toBe('conflict');
    expect(second.reservation.rejectionReason).toBe('no_availability');
    expect(manager.getInventory('property-1', 'default', '2026-07-10')?.bookedUnits).toBe(1);
  });

  it('returns availability after cancellation', async () => {
    const manager = new InMemoryChannelManagerCore();
    seedTwoNights(manager);

    const first = await manager.createReservation({
      propertyId: 'property-1',
      guestName: 'Ирина',
      checkInDate: '2026-07-10',
      checkOutDate: '2026-07-12',
    });
    await manager.cancelReservation(first.reservation.id);

    const day = manager.getInventory('property-1', 'default', '2026-07-10');
    expect(day?.bookedUnits).toBe(0);
    expect(day ? availableUnits(day) : 0).toBe(1);
  });

  it('modifies dates and recalculates booked nights', async () => {
    const manager = new InMemoryChannelManagerCore();
    seedTwoNights(manager);
    manager.setInventory({
      propertyId: 'property-1',
      unitKey: 'default',
      day: '2026-07-12',
      totalUnits: 1,
      bookedUnits: 0,
      manualBlockedUnits: 0,
    });

    const first = await manager.createReservation({
      propertyId: 'property-1',
      guestName: 'Ирина',
      checkInDate: '2026-07-10',
      checkOutDate: '2026-07-12',
    });
    const changed = await manager.modifyReservationDates(first.reservation.id, '2026-07-11', '2026-07-13');

    expect(changed.available).toBe(true);
    expect(manager.getInventory('property-1', 'default', '2026-07-10')?.bookedUnits).toBe(0);
    expect(manager.getInventory('property-1', 'default', '2026-07-12')?.bookedUnits).toBe(1);
  });

  it('manual block reduces availability and blocks auto-confirmation', async () => {
    const manager = new InMemoryChannelManagerCore();
    seedTwoNights(manager, 1);

    const result = await manager.createReservation({
      propertyId: 'property-1',
      guestName: 'Ирина',
      checkInDate: '2026-07-10',
      checkOutDate: '2026-07-12',
    });

    expect(result.available).toBe(false);
    expect(result.reservation.status).toBe('conflict');
  });

  it('parallel reservations do not overbook the same unit', async () => {
    const manager = new InMemoryChannelManagerCore();
    seedTwoNights(manager);

    const results = await Promise.all([
      manager.createReservation({
        propertyId: 'property-1',
        guestName: 'Ирина',
        checkInDate: '2026-07-10',
        checkOutDate: '2026-07-12',
      }),
      manager.createReservation({
        propertyId: 'property-1',
        guestName: 'Олег',
        checkInDate: '2026-07-10',
        checkOutDate: '2026-07-12',
      }),
    ]);

    expect(results.filter((result) => result.available)).toHaveLength(1);
    expect(results.filter((result) => result.reservation.status === 'conflict')).toHaveLength(1);
    expect(results.find((result) => result.reservation.status === 'conflict')?.reservation.rejectionReason).toBe(
      'no_availability',
    );
    expect(manager.getInventory('property-1', 'default', '2026-07-10')?.bookedUnits).toBe(1);
    const day = manager.getInventory('property-1', 'default', '2026-07-10');
    expect(day ? availableUnits(day) : -1).toBe(0);
  });

  it('does not create a duplicate for the same external booking id', async () => {
    const manager = new InMemoryChannelManagerCore();
    seedTwoNights(manager);

    const first = await manager.createReservation({
      propertyId: 'property-1',
      channelCode: 'manual',
      externalBookingId: 'same-id',
      guestName: 'Ирина',
      checkInDate: '2026-07-10',
      checkOutDate: '2026-07-12',
    });
    const retry = await manager.createReservation({
      propertyId: 'property-1',
      channelCode: 'manual',
      externalBookingId: 'same-id',
      guestName: 'Ирина',
      checkInDate: '2026-07-10',
      checkOutDate: '2026-07-12',
    });

    expect(retry.idempotent).toBe(true);
    expect(retry.reservation.id).toBe(first.reservation.id);
    expect(manager.getInventory('property-1', 'default', '2026-07-10')?.bookedUnits).toBe(1);
  });

  it('gives a longer pending request a higher priority without cancelling a confirmed booking', async () => {
    const manager = new InMemoryChannelManagerCore();
    seedTwoNights(manager);
    seedTwoNights(manager, 0, 'property-2');
    manager.setInventory({
      propertyId: 'property-2',
      unitKey: 'default',
      day: '2026-07-12',
      totalUnits: 1,
      bookedUnits: 0,
      manualBlockedUnits: 0,
    });

    const confirmed = await manager.createReservation({
      propertyId: 'property-1',
      guestName: 'Ирина',
      checkInDate: '2026-07-10',
      checkOutDate: '2026-07-12',
      totalAmount: 10000,
    });
    const shortPending = await manager.createReservation({
      propertyId: 'property-2',
      guestName: 'Олег',
      checkInDate: '2026-07-10',
      checkOutDate: '2026-07-12',
      confirmationMode: 'pending',
      totalAmount: 10000,
    });
    const longPending = await manager.createReservation({
      propertyId: 'property-2',
      guestName: 'Анна',
      checkInDate: '2026-07-10',
      checkOutDate: '2026-07-13',
      confirmationMode: 'pending',
      totalAmount: 12000,
    });

    expect(shortPending.reservation.status).toBe('pending');
    expect(longPending.reservation.status).toBe('pending');
    expect(longPending.reservation.priorityScore).toBeGreaterThan(shortPending.reservation.priorityScore);
    expect(manager.getReservation(confirmed.reservation.id)?.status).toBe('confirmed');
  });

  it('projects shadow availability without mutating inventory', () => {
    const manager = new InMemoryChannelManagerCore();
    seedTwoNights(manager);

    const projection = calculateShadowAvailabilityProjection({
      eventType: 'reservation_created',
      nights: ['2026-07-10', '2026-07-11'],
      availableByDay: {
        '2026-07-10': manager.getInventory('property-1', 'default', '2026-07-10')?.bookedUnits === 0 ? 1 : 0,
        '2026-07-11': manager.getInventory('property-1', 'default', '2026-07-11')?.bookedUnits === 0 ? 1 : 0,
      },
      quantity: 1,
    });

    expect(projection).toEqual({
      available: true,
      projectedAvailability: {
        '2026-07-10': 0,
        '2026-07-11': 0,
      },
    });
    expect(manager.getInventory('property-1', 'default', '2026-07-10')?.bookedUnits).toBe(0);
  });
});
