import { describe, expect, it } from 'vitest';
import {
  decideCommunicationAutopilotResponse,
  type CommunicationAutopilotContext,
} from '../autopilot';

const fullContext: CommunicationAutopilotContext = {
  session: {
    id: 'session-1',
    guestName: 'Ирина',
    language: 'ru',
  },
  booking: {
    id: 'booking-1',
    checkInTime: '15:00',
    checkoutTime: '12:00',
    earlyCheckInAvailable: false,
    lateCheckoutAvailable: true,
  },
  object: {
    id: 'object-1',
    address: 'Санкт-Петербург, Невский проспект, 24',
    accessInstructions: 'войдите через арку, код на двери 2468, квартира 12',
    accessCode: '2468',
    wifiName: 'ASI Guest',
    wifiPassword: 'welcome24',
  },
};

describe('communication autopilot MVP', () => {
  it('auto-replies to RU check-in and access questions when context is available', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Здравствуйте, как попасть в квартиру и заселиться?',
      context: fullContext,
    });

    expect(decision.action).toBe('auto_reply');
    expect(decision.confidence).toBeGreaterThan(0.8);
    expect(decision.replyText).toContain('Адрес: Санкт-Петербург, Невский проспект, 24.');
    expect(decision.replyText).toContain('Как попасть: войдите через арку');
    expect(decision.replyText).toContain('Код доступа: 2468.');
    expect(decision.metadata).toEqual(
      expect.objectContaining({
        intent: 'check_in_access',
        channelMode: 'active',
        policy: 'deterministic_mvp_v1',
        urgent: false,
      }),
    );
  });

  it('auto-replies with Wi-Fi details when object context is available', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'email',
      messageText: 'Подскажите пароль от вай-фай',
      context: fullContext,
    });

    expect(decision.action).toBe('auto_reply');
    expect(decision.replyText).toBe('Wi-Fi: ASI Guest. Пароль: welcome24.');
    expect(decision.metadata.channelMode).toBe('foundation');
    expect(decision.metadata.intent).toBe('wifi');
  });

  it('returns needs_context instead of inventing address or instructions', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Пришлите адрес и инструкцию для заселения',
      context: {
        booking: {
          id: 'booking-2',
        },
      },
    });

    expect(decision.action).toBe('needs_context');
    expect(decision.replyText).toBeUndefined();
    expect(decision.escalationReason).toBeUndefined();
    expect(decision.metadata.missingContext).toContain('object.address');
  });

  it('auto-replies to checkout questions when booking context has checkout time', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'До скольки выезд?',
      context: fullContext,
    });

    expect(decision.action).toBe('auto_reply');
    expect(decision.replyText).toBe('Выезд до 12:00. Ключи оставьте по инструкции из заселения.');
    expect(decision.metadata.intent).toBe('checkout');
  });

  it('auto-replies to early check-in and late checkout questions with known availability', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'email',
      messageText: 'Можно ранний заезд или поздний выезд?',
      context: fullContext,
    });

    expect(decision.action).toBe('auto_reply');
    expect(decision.replyText).toBe(
      'Ранний заезд сейчас не подтвержден. Поздний выезд сейчас возможен. Если планы изменятся, напишите - проверим еще раз.',
    );
    expect(decision.metadata.intent).toBe('early_checkin_late_checkout');
  });

  it('escalates urgent access, lock, and code failures', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Срочно, код не работает, я на улице и не могу попасть',
      context: fullContext,
    });

    expect(decision.action).toBe('escalate');
    expect(decision.replyText).toBeUndefined();
    expect(decision.escalationReason).toBe('urgent_access_problem');
    expect(decision.metadata).toEqual(
      expect.objectContaining({
        intent: 'urgent_access_problem',
        urgent: true,
      }),
    );
    expect(decision.metadata.operationsAction).toEqual(
      expect.objectContaining({
        category: 'operator_access_support',
        priority: 'high',
        shortReason: 'urgent_access_problem',
      }),
    );
  });

  it('classifies cleaning issues as operations handoff with cleaning assignment metadata', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'В квартире грязно и нет полотенец',
      context: fullContext,
    });

    expect(decision.action).toBe('escalate');
    expect(decision.escalationReason).toBe('cleaning_issue');
    expect(decision.metadata.intent).toBe('cleaning_issue');
    expect(decision.metadata.operationsAction).toEqual(
      expect.objectContaining({
        category: 'cleaning',
        priority: 'normal',
        shortReason: 'cleaning_issue',
      }),
    );
  });

  it('classifies maintenance issues as operations handoff with maintenance metadata', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'email',
      messageText: 'Протекает душ и не работает свет',
      context: fullContext,
    });

    expect(decision.action).toBe('escalate');
    expect(decision.escalationReason).toBe('maintenance_issue');
    expect(decision.metadata.intent).toBe('maintenance_issue');
    expect(decision.metadata.operationsAction).toEqual(
      expect.objectContaining({
        category: 'maintenance',
        priority: 'normal',
        shortReason: 'maintenance_issue',
      }),
    );
  });

  it('asks for context before creating cleaning or maintenance actions without booking/object context', () => {
    const cleaning = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Не убрано, грязно',
      context: {},
    });
    const maintenance = decideCommunicationAutopilotResponse({
      channel: 'email',
      messageText: 'Broken shower',
      context: {},
    });

    expect(cleaning.action).toBe('needs_context');
    expect(cleaning.metadata.missingContext).toContain('object.id');
    expect(maintenance.action).toBe('needs_context');
    expect(maintenance.metadata.missingContext).toContain('object.id');
  });

  it('keeps phone planned only while still returning audit metadata', () => {
    const decision = decideCommunicationAutopilotResponse({
      channel: 'phone',
      messageText: 'Где адрес?',
      context: fullContext,
    });

    expect(decision.action).toBe('auto_reply');
    expect(decision.metadata.channelMode).toBe('planned');
  });
});
