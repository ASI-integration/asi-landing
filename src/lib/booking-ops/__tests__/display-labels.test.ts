import { describe, expect, it } from 'vitest';
import {
  formatBookingOpsGuestNameDisplay,
  formatBookingOpsMessageTextDisplay,
  formatBookingOpsNotesDisplay,
  formatBookingOpsOtaSourceDisplay,
  formatBookingOpsPropertyLabelDisplay,
  guestNameForGuestFacingCopy,
  propertyLabelForGuestFacingCopy,
  resolveBookingOpsEditDraftSaveValue,
  toBookingOpsEditDraftDisplayValue,
} from '@/lib/booking-ops/display-labels';

describe('booking-ops display labels', () => {
  it('maps pilot dry-run guest names to demo label', () => {
    expect(formatBookingOpsGuestNameDisplay('ASI_BOOKING_OPS_PILOT_DRY_RUN_001')).toBe('Тестовый гость');
    expect(formatBookingOpsGuestNameDisplay('Анна Смирнова')).toBe('Анна Смирнова');
    expect(formatBookingOpsGuestNameDisplay(null)).toBe('—');
  });

  it('maps demo property labels', () => {
    expect(formatBookingOpsPropertyLabelDisplay('Dry Run Apartments')).toBe('Тестовый объект');
    expect(formatBookingOpsPropertyLabelDisplay('Студия у метро')).toBe('Студия у метро');
    expect(formatBookingOpsPropertyLabelDisplay(null, 'OBJ-1')).toBe('OBJ-1');
  });

  it('maps manual ota source', () => {
    expect(formatBookingOpsOtaSourceDisplay('manual')).toBe('Ручной ввод');
    expect(formatBookingOpsOtaSourceDisplay('avito')).toBe('avito');
  });

  it('maps pilot dry-run notes to demo label', () => {
    expect(formatBookingOpsNotesDisplay('ASI_BOOKING_OPS_PILOT_DRY_RUN_notes abc')).toBe('Тестовая заметка');
    expect(formatBookingOpsNotesDisplay('Заметка оператора')).toBe('Заметка оператора');
    expect(formatBookingOpsNotesDisplay(null)).toBe('');
  });

  it('uses display-safe guest-facing copy labels', () => {
    expect(guestNameForGuestFacingCopy('ASI_BOOKING_OPS_PILOT_DRY_RUN_001')).toBe('Тестовый гость');
    expect(propertyLabelForGuestFacingCopy('Dry Run Apartments')).toBe('Тестовый объект');
    expect(
      formatBookingOpsMessageTextDisplay(
        'Здравствуйте, ASI_BOOKING_OPS_PILOT_DRY_RUN_001!\n\nДля оформления заезда в «Dry Run Apartments»',
      ),
    ).toContain('Тестовый гость');
    expect(
      formatBookingOpsMessageTextDisplay(
        'Здравствуйте, ASI_BOOKING_OPS_PILOT_DRY_RUN_001!\n\nДля оформления заезда в «Dry Run Apartments»',
      ),
    ).toContain('Тестовый объект');
  });

  it('maps edit draft display values and preserves raw values on unchanged save', () => {
    expect(
      toBookingOpsEditDraftDisplayValue('guestName', 'ASI_BOOKING_OPS_PILOT_DRY_RUN_001'),
    ).toBe('Тестовый гость');
    expect(
      resolveBookingOpsEditDraftSaveValue(
        'guestName',
        'Тестовый гость',
        'ASI_BOOKING_OPS_PILOT_DRY_RUN_001',
      ),
    ).toBe('ASI_BOOKING_OPS_PILOT_DRY_RUN_001');
    expect(
      resolveBookingOpsEditDraftSaveValue('otaSource', 'Ручной ввод', 'manual'),
    ).toBe('manual');
    expect(
      resolveBookingOpsEditDraftSaveValue(
        'notes',
        'Тестовая заметка',
        'ASI_BOOKING_OPS_PILOT_DRY_RUN_notes xyz',
      ),
    ).toBe('ASI_BOOKING_OPS_PILOT_DRY_RUN_notes xyz');
  });
});
