import { describe, expect, it } from 'vitest';
import {
  buildOperatorHandoffDecision,
  shouldCreateOperatorHandoff,
} from '../operator-handoff-decision';

describe('Operator handoff decision v1', () => {
  it('creates handoff for urgent access', () => {
    expect(
      shouldCreateOperatorHandoff({
        agent: {
          intent: 'urgent_access_problem',
          confidence: 0.94,
          action: 'escalate',
          needs_booking_lookup: true,
          needs_operator: true,
          can_auto_reply: false,
          safety_flags: ['urgent_access', 'no_invented_facts'],
          source: 'policy_guard',
        },
      }),
    ).toBe(true);

    const handoff = buildOperatorHandoffDecision({
      channel: 'telegram',
      guestMessage: 'код не работает',
      agent: {
        intent: 'urgent_access_problem',
        confidence: 0.94,
        action: 'escalate',
        needs_booking_lookup: true,
        needs_operator: true,
        can_auto_reply: false,
        safety_flags: ['urgent_access', 'no_invented_facts'],
        reply_text: 'Передаю оператору.',
        source: 'policy_guard',
      },
      bookingId: 'bk-1',
      propertyId: 'prop-1',
    });

    expect(handoff).toMatchObject({
      urgency: 'critical',
      resolved_booking_id: 'bk-1',
      resolved_property_id: 'prop-1',
      safe_to_auto_send: false,
    });
  });

  it('skips handoff for safe wifi clarify', () => {
    const handoff = buildOperatorHandoffDecision({
      channel: 'telegram',
      guestMessage: 'пароль от вайфая',
      autopilot: {
        action: 'needs_context',
        confidence: 0.9,
        replyText: 'Напишите номер брони.',
        metadata: {
          intent: 'wifi',
          matchedSignals: [],
          missingContext: ['object.wifi'],
          contextKeys: [],
          channelMode: 'active',
          urgent: false,
          policy: 'deterministic_mvp_v1',
        },
      },
    });
    expect(handoff).toBeNull();
  });

  it('flags low-confidence risky reply for operator review', () => {
    const handoff = buildOperatorHandoffDecision({
      channel: 'email',
      guestMessage: 'верните деньги',
      autopilot: {
        action: 'escalate',
        confidence: 0.55,
        escalationReason: 'booking_payment_support',
        metadata: {
          intent: 'booking_payment_support',
          matchedSignals: [],
          missingContext: [],
          contextKeys: [],
          channelMode: 'foundation',
          urgent: false,
          policy: 'deterministic_mvp_v1',
        },
      },
    });
    expect(handoff?.guest_channel).toBe('email');
    expect(handoff?.safe_to_auto_send).toBe(false);
  });
});
