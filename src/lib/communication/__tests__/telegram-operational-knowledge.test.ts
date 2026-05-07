import { describe, expect, it } from 'vitest';
import { TELEGRAM_OPERATIONAL_KNOWLEDGE_V1 } from '../telegram-operational-knowledge';

describe('TELEGRAM_OPERATIONAL_KNOWLEDGE_V1', () => {
  it('contains all required scenario families', () => {
    expect(Object.keys(TELEGRAM_OPERATIONAL_KNOWLEDGE_V1).sort()).toEqual([
      'ACCESS_KEY_ISSUE',
      'ADDRESS_FIND_OBJECT',
      'BOOKING_CONTEXT',
      'CANCELLATION_REFUND',
      'CHECK_IN_EARLY',
      'CHECK_IN_STANDARD',
      'CHECK_IN_VERY_EARLY',
      'CLEANING_LINEN_TOWELS',
      'COMPLAINTS_PROBLEMS',
      'DOCUMENTS_PASSPORT',
      'EMERGENCY_URGENT_ISSUE',
      'ESCALATE_TO_OPERATOR',
      'EXTRA_GUESTS',
      'LATE_CHECKOUT',
      'OBJECT_CLARIFICATION',
      'OPERATOR_HANDOFF',
      'PARKING',
      'PAYMENT_DEPOSIT',
      'PETS',
      'SLOW_ACK',
      'UNKNOWN_OPERATIONAL_REQUEST',
      'WIFI',
    ]);
  });
});

