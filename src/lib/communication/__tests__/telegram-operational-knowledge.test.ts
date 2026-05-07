import { describe, expect, it } from 'vitest';
import { TELEGRAM_OPERATIONAL_KNOWLEDGE_V1 } from '../telegram-operational-knowledge';

describe('TELEGRAM_OPERATIONAL_KNOWLEDGE_V1', () => {
  it('contains all required scenario families', () => {
    expect(Object.keys(TELEGRAM_OPERATIONAL_KNOWLEDGE_V1).sort()).toEqual([
      'BOOKING_CONTEXT',
      'CHECK_IN_EARLY',
      'CHECK_IN_STANDARD',
      'CHECK_IN_VERY_EARLY',
      'ESCALATE_TO_OPERATOR',
      'OBJECT_CLARIFICATION',
      'SLOW_ACK',
      'UNKNOWN_OPERATIONAL_REQUEST',
    ]);
  });
});

