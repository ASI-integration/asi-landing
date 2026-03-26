import { describe, expect, it } from 'vitest';
import { extractBookingDraft } from '../booking-draft';

describe('extractBookingDraft', () => {
  it('extracts property, stay duration, and parking from a Litейный booking request', () => {
    const draft = extractBookingDraft('Литейный, 38 на 4 ночи и парковку, пожалуйста');

    expect(draft).toMatchObject({
      propertyLabel: 'Литейный, 38',
      stayNights: 4,
      specificRequests: ['parking'],
    });
  });

  it('extracts guest name when explicitly provided', () => {
    const draft = extractBookingDraft('Имя гостя: Иван Петров, нужна парковка');

    expect(draft).toMatchObject({
      guestName: 'Иван Петров',
      specificRequests: ['parking'],
    });
  });
});