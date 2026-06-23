import { describe, expect, it } from 'vitest';
import { parseBookingTextImport } from '@/lib/bookings/text-import';

describe('booking text import', () => {
  const properties = [
    { propertyId: 'lit_12', label: 'Литейный 12' },
    { propertyId: 'nev_24', label: 'Невский 24' },
  ];

  it('parses a free-form Russian booking message with high confidence', () => {
    const result = parseBookingTextImport({
      text: 'Иван, +79001234567, Литейный 12, заезд 24.06, выезд 26.06, канал Авито',
      properties,
    });

    expect(result.propertyId).toBe('lit_12');
    expect(result.guestName).toBe('Иван');
    expect(result.guestContact).toBe('+79001234567');
    expect(result.checkIn).toBe('2026-06-24');
    expect(result.checkOut).toBe('2026-06-26');
    expect(result.channel).toBe('avito');
    expect(result.confidence).toBe('high');
    expect(result.reservationRef).toContain('lit_12');
  });

  it('returns medium confidence when object is missing', () => {
    const result = parseBookingTextImport({
      text: 'Мария +79007654321 заезд 01.07 выезд 03.07',
      properties,
    });

    expect(result.propertyId).toBeNull();
    expect(result.confidence).toBe('medium');
    expect(result.missingFields).toContain('объект');
  });

  it('dedup reservation ref uses guest and dates', () => {
    const first = parseBookingTextImport({
      text: 'Пётр, +79001112233, Невский 24, заезд 10.08, выезд 12.08',
      properties,
    });
    const second = parseBookingTextImport({
      text: 'Пётр, +79001112233, Невский 24, заезд 10.08, выезд 12.08',
      properties,
    });
    expect(first.reservationRef).toBe(second.reservationRef);
  });
});
