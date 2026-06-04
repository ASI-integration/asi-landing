import { describe, expect, it } from 'vitest';
import type { CommunicationAutopilotContext } from '../autopilot';
import {
  guestReplyContainsForbiddenBookingWording,
  inferWifiProblemStep,
  resolveWifiProblemPolicy,
  WIFI_DIAGNOSTIC_FAILED_OBJECT_RESOLVED_RU,
  WIFI_ESCALATION_OPERATOR_OBJECT_RESOLVED_RU,
  WIFI_OBJECT_UNKNOWN_ASK_RU,
  wifiReplyHasFirstStepAdvice,
} from '../wifi-escalation-policy';
import { normalizeBookingWordingRu } from '../guest-facing-ru';

const resolvedContext: CommunicationAutopilotContext = {
  propertyResolved: true,
  bookingVerified: true,
  booking: { id: 'BK-100' },
  object: { id: 'obj-1', wifiName: 'ASI-Guest' },
};

const unresolvedObjectContext: CommunicationAutopilotContext = {
  propertyResolved: false,
  bookingVerified: false,
};

const firstStepReply =
  'Хорошо, если Wi-Fi подключён, но сайты не открываются, попробуйте открыть любой другой сайт и на минуту выключить/включить Wi-Fi на устройстве.';

describe('wifi escalation policy', () => {
  it('wifi_problem third step + object resolved → does not ask for booking number', () => {
    expect(
      inferWifiProblemStep({
        previousIntent: 'wifi_problem',
        previousReply: firstStepReply,
        continuationUsed: true,
        messageText: 'сайты всё равно не открываются',
      }),
    ).toBe(3);

    const result = resolveWifiProblemPolicy({
      messageText: 'сайты всё равно не открываются',
      context: resolvedContext,
      previousReply: firstStepReply,
      continuationUsed: true,
      previousIntent: 'wifi_problem',
    });

    expect(result.step).toBe(3);
    expect(result.replyText).toBe(WIFI_DIAGNOSTIC_FAILED_OBJECT_RESOLVED_RU);
    expect(result.replyText).not.toMatch(/номер бронирования|адрес/i);
    expect(result.audit.object_resolved).toBe(true);
    expect(result.audit.booking_resolved).toBe(true);
    expect(result.audit.booking_request_reason).toBeNull();
    expect(guestReplyContainsForbiddenBookingWording(result.replyText)).toBe(false);
  });

  it('wifi_problem third step + object not resolved → asks address or booking number', () => {
    const result = resolveWifiProblemPolicy({
      messageText: 'сайт не грузит',
      context: unresolvedObjectContext,
      previousReply: firstStepReply,
      continuationUsed: true,
      previousIntent: 'wifi_problem',
    });

    expect(result.step).toBe(3);
    expect(result.replyText).toBe(WIFI_OBJECT_UNKNOWN_ASK_RU);
    expect(result.replyText).toMatch(/адрес или номер бронирования/i);
    expect(result.audit.object_resolved).toBe(false);
    expect(result.audit.booking_request_reason).toBe('object_unknown');
    expect(guestReplyContainsForbiddenBookingWording(result.replyText)).toBe(false);
  });

  it('escalation + object resolved → does not ask for booking again', () => {
    const result = resolveWifiProblemPolicy({
      messageText: 'передайте оператору, интернет не работает',
      context: resolvedContext,
      forceEscalation: true,
    });

    expect(result.escalationNeeded).toBe(true);
    expect(result.replyText).toBe(WIFI_ESCALATION_OPERATOR_OBJECT_RESOLVED_RU);
    expect(result.replyText).not.toMatch(/номер бронирования|адрес/i);
    expect(result.audit.booking_request_reason).toBeNull();
    expect(result.audit.escalation_needed).toBe(true);
  });

  it('escalation + object unknown → asks address or booking number', () => {
    const result = resolveWifiProblemPolicy({
      messageText: 'нужен оператор, wi-fi не работает',
      context: unresolvedObjectContext,
      forceEscalation: true,
    });

    expect(result.replyText).toMatch(/оператор/i);
    expect(result.replyText).toMatch(/адрес или номер бронирования/i);
    expect(result.audit.booking_request_reason).toBe('escalation_context');
    expect(guestReplyContainsForbiddenBookingWording(result.replyText)).toBe(false);
  });

  it('guest-facing wifi replies do not contain «брони»', () => {
    const samples = [
      firstStepReply,
      WIFI_DIAGNOSTIC_FAILED_OBJECT_RESOLVED_RU,
      WIFI_OBJECT_UNKNOWN_ASK_RU,
      WIFI_ESCALATION_OPERATOR_OBJECT_RESOLVED_RU,
      normalizeBookingWordingRu('уточните номер брони') ?? '',
    ];
    for (const text of samples) {
      expect(guestReplyContainsForbiddenBookingWording(text)).toBe(false);
    }
    expect(wifiReplyHasFirstStepAdvice(firstStepReply)).toBe(true);
  });
});
