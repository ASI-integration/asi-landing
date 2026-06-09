/**
 * Тесты парсеров OPS v1 foundation.
 */

import { describe, it, expect } from 'vitest';
import {
  parseCreateIncidentInput,
  parseCreatePropertyInput,
  parseCreateReservationInput,
  parseCreateTaskInput,
  parseUpdateMasterCardInput,
} from '@/lib/ops-foundation/parsers';

describe('ops-foundation parsers', () => {
  it('parseCreatePropertyInput требует title', () => {
    expect(parseCreatePropertyInput({})).toBeNull();
    expect(parseCreatePropertyInput({ title: '  ' })).toBeNull();
    expect(parseCreatePropertyInput({ title: 'Студия' })).toEqual({
      title: 'Студия',
      address: undefined,
      city: undefined,
      timezone: undefined,
      status: undefined,
    });
  });

  it('parseUpdateMasterCardInput парсит amenities', () => {
    expect(parseUpdateMasterCardInput({ amenities: ['Wi-Fi', 'TV'] })).toEqual({
      publicTitle: undefined,
      shortDescription: undefined,
      fullDescription: undefined,
      amenities: ['Wi-Fi', 'TV'],
      houseRules: undefined,
      checkInInstructions: undefined,
      checkOutInstructions: undefined,
      wifiName: undefined,
      wifiPassword: undefined,
      parkingInfo: undefined,
      depositInfo: undefined,
      extraFeesInfo: undefined,
      cancellationInfo: undefined,
      guestContactsInfo: undefined,
      internalNotes: undefined,
      publicationStatus: undefined,
    });
  });

  it('parseCreateReservationInput требует обязательные поля', () => {
    expect(parseCreateReservationInput({})).toBeNull();
    expect(
      parseCreateReservationInput({
        propertyId: 'p1',
        guestName: 'Иван',
        checkInDate: '2026-06-10',
        checkOutDate: '2026-06-12',
      }),
    ).toEqual({
      propertyId: 'p1',
      guestName: 'Иван',
      guestPhone: undefined,
      guestEmail: undefined,
      sourceChannel: undefined,
      externalReservationId: undefined,
      checkInDate: '2026-06-10',
      checkOutDate: '2026-06-12',
      status: undefined,
      paymentStatus: undefined,
      depositStatus: undefined,
      notes: undefined,
    });
  });

  it('parseCreateTaskInput принимает reservationId', () => {
    expect(
      parseCreateTaskInput({
        propertyId: 'p1',
        title: 'Уборка',
        reservationId: 'r1',
      }),
    ).toEqual({
      propertyId: 'p1',
      reservationId: 'r1',
      title: 'Уборка',
      description: undefined,
      category: undefined,
      priority: undefined,
      status: undefined,
      dueAt: undefined,
      assignedTo: undefined,
      source: undefined,
      escalationSource: undefined,
    });
  });

  it('parseCreateIncidentInput парсит escalationRequired', () => {
    expect(
      parseCreateIncidentInput({
        propertyId: 'p1',
        title: 'Шум',
        escalationRequired: true,
      }),
    ).toEqual({
      propertyId: 'p1',
      reservationId: undefined,
      title: 'Шум',
      description: undefined,
      severity: undefined,
      status: undefined,
      source: undefined,
      escalationRequired: true,
      escalationSource: undefined,
    });
  });
});
