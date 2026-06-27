import { describe, expect, it } from 'vitest';
import { parseCreateBookingOpsInput, parseUpdateBookingOpsInput } from '../validation';

describe('Guest/Booking Ops v1 validation', () => {
  it('requires guest name on create', () => {
    expect(parseCreateBookingOpsInput({})).toEqual({ error: 'Укажите имя гостя.' });
  });

  it('accepts valid create payload', () => {
    const result = parseCreateBookingOpsInput({
      guestName: 'Мария',
      guestPhone: '+79990000002',
      propertyId: 'OBJ-2',
      documentsStatus: 'requested',
    });
    expect(result).toEqual({
      input: {
        bookingId: null,
        guestName: 'Мария',
        guestPhone: '+79990000002',
        guestEmail: null,
        guestTelegram: null,
        propertyId: 'OBJ-2',
        propertyLabel: null,
        otaSource: null,
        checkInAt: null,
        checkOutAt: null,
        notes: null,
        documentsStatus: 'requested',
      },
    });
  });

  it('rejects invalid status values instead of silently normalizing', () => {
    expect(parseUpdateBookingOpsInput({ documentsStatus: 'unknown_status' })).toEqual({
      error: 'Статус документов: недопустимое значение «unknown_status».',
    });
  });

  it('accepts partial update with valid enum values', () => {
    const result = parseUpdateBookingOpsInput({
      contractStatus: 'sent',
      depositStatus: 'requested',
      notes: 'Оставить заметку',
    });
    expect(result).toEqual({
      input: {
        contractStatus: 'sent',
        depositStatus: 'requested',
        notes: 'Оставить заметку',
      },
    });
  });
});
