import { describe, expect, it } from 'vitest';
import {
  formatBookingOpsGuestNameDisplay,
  formatBookingOpsOtaSourceDisplay,
  formatBookingOpsPropertyLabelDisplay,
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
});
