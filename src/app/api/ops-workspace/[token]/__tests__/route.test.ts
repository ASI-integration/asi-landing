import { describe, expect, it } from 'vitest';
import { workerCompletionEventType } from '../route';

describe('secure worker workspace completion events', () => {
  it('emits inspection.completed for the normal inspector task', () => {
    expect(workerCompletionEventType('inspector', 'booking-1:inspector')).toBe('inspection.completed');
  });

  it('emits checkout.inspection_completed for the checkout inspector task', () => {
    expect(workerCompletionEventType('inspector', 'booking-1:checkout:inspector')).toBe('checkout.inspection_completed');
  });
});
