import { describe, expect, it } from 'vitest';
import { runCommunicationAutopilotV1 } from '../communication-autopilot-v1';
import {
  classifyKnowledgeTopic,
  requiresAutopilotOperatorEscalation,
} from '../knowledge-resolver';

describe('live rehearsal regressions: house rules and access urgency', () => {
  const property = {
    object_id: 'prop_A',
    object_name: 'Тестовый объект Communication Autopilot',
    address: 'Санкт-Петербург',
    check_in_text: 'после 14:00; бесконтактное заселение, инструкция отправляется после подтверждения бронирования',
    checkout_time: '12:00',
    house_rules_text: 'Не курить, без вечеринок, соблюдать тишину после 22:00.',
  } as any;

  it('routes a Russian loud-music cutoff question to house rules, not check-in time', () => {
    const messageText = 'До которого часа можно громко включать музыку?';

    expect(classifyKnowledgeTopic(messageText)).toBe('house_rules');

    const result = runCommunicationAutopilotV1({
      messageText,
      property,
      propertyId: 'prop_A',
      bookingVerified: true,
    });

    expect(result.action).toBe('auto_reply');
    expect(result.topic).toBe('house_rules');
    expect(result.knowledgeSource).toBe('rules');
    expect(result.replyText).toMatch(/22:00/);
    expect(result.replyText).not.toMatch(/14:00/);
    expect(result.replyText).not.toMatch(/бесконтактное заселение/i);
  });

  it('does not substitute check-in data when house rules are missing', () => {
    const result = runCommunicationAutopilotV1({
      messageText: 'До которого часа можно слушать громкую музыку?',
      property: {
        ...property,
        house_rules_text: null,
      },
      propertyId: 'prop_A',
      bookingVerified: true,
    });

    expect(result.action).toBe('clarification');
    expect(result.topic).toBe('house_rules');
    expect(result.missingFields).toContain('object.house_rules_text');
    expect(result.replyText).not.toMatch(/14:00/);
    expect(result.replyText).not.toMatch(/бесконтактное заселение/i);
  });

  it('treats a broken apartment lock as an urgent access problem', () => {
    const messageText = 'Мы подъехали к квартире, но замок оказался сломан. Честно говоря, мы недовольны.';

    expect(requiresAutopilotOperatorEscalation(messageText)).toBe('urgent_access_problem');

    const result = runCommunicationAutopilotV1({
      messageText,
      property,
      propertyId: 'prop_A',
      bookingVerified: true,
    });

    expect(result.action).toBe('operator_handoff');
    expect(result.needsOperator).toBe(true);
    expect(result.escalationReason).toBe('urgent_access_problem');
  });

  it('keeps neighbour loud-music complaints in operator escalation', () => {
    const messageText = 'Соседи рядом очень громко включили музыку и мешают спать.';

    expect(requiresAutopilotOperatorEscalation(messageText)).toBe('noise_complaint');
  });
});
