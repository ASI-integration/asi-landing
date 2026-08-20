import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessMessage = vi.fn();
const mockBindIdentity = vi.fn();
const mockResolveIdentityRoute = vi.fn();
const mockResolveEmailBookingContext = vi.fn();
const mockBookingContextToFields = vi.fn();
const mockDecideAutopilot = vi.fn();
const mockCanClassifyInbound = vi.fn();
const mockGetSession = vi.fn();
const mockAppendSession = vi.fn();
const mockCreateReview = vi.fn();
const mockNotifyOperator = vi.fn();
const mockAuditDecision = vi.fn();

vi.mock('../orchestrator', () => ({
  processMessage: (...args: unknown[]) => mockProcessMessage(...args),
}));

vi.mock('../identity-binding', () => ({
  bindIdentity: (...args: unknown[]) => mockBindIdentity(...args),
}));

vi.mock('../communication-identity-routing', () => ({
  resolveCommunicationIdentityRoute: (...args: unknown[]) => mockResolveIdentityRoute(...args),
}));

vi.mock('../telegram-booking-object-memory', () => ({
  resolveEmailGuestBookingObjectContext: (...args: unknown[]) => mockResolveEmailBookingContext(...args),
  bookingObjectContextToAutopilotFields: (...args: unknown[]) => mockBookingContextToFields(...args),
}));

vi.mock('../autopilot', () => ({
  decideCommunicationAutopilotResponse: (...args: unknown[]) => mockDecideAutopilot(...args),
}));

vi.mock('../communication-autopilot-settings', () => ({
  canClassifyInboundCommunication: (...args: unknown[]) => mockCanClassifyInbound(...args),
}));

vi.mock('../conversation-session-engine', () => ({
  getOrCreateConversationSession: (...args: unknown[]) => mockGetSession(...args),
  appendSessionMessage: (...args: unknown[]) => mockAppendSession(...args),
}));

vi.mock('../operator-review', () => ({
  createOrUpdateEscalationReview: (...args: unknown[]) => mockCreateReview(...args),
  getActiveEscalationReviewIdForSession: () => null,
  getEscalationReview: () => null,
}));

vi.mock('../operator-notify', () => ({
  notifyOperator: (...args: unknown[]) => mockNotifyOperator(...args),
}));

vi.mock('../audit', () => ({
  auditInbound: vi.fn(),
  auditDecision: (...args: unknown[]) => mockAuditDecision(...args),
}));

vi.mock('../idempotency', () => ({
  checkAndMarkKey: vi.fn(() => false),
}));

import { processEmailInbound } from '../email-inbound-processor';
import { ProcessOutcome } from '../types';

const GENERIC_CLARIFICATION =
  'Уточните, пожалуйста: это про какой объект или номер брони?\n\nBest regards,\nASI Support\nsupport@asi-global.ru';
const GROUNDED_CHECKOUT = 'Выезд до 12:00. Ключи оставьте по инструкции из заселения.';

function session() {
  return {
    sessionId: 'sess-grounded-email',
    actorId: 'project.ayfaar@gmail.com',
    role: 'guest',
    confidence: 0.99,
    reservationId: 'reservation-1',
    propertyId: 'test-prop-tg-live',
    memory: { lastMessages: [] },
  };
}

describe('email draft-only grounded reply recovery', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('EMAIL_AUTO_SEND', 'false');
    vi.stubEnv('EMAIL_DRAFT_ONLY', 'true');
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'support@asi-global.ru');

    for (const mock of [
      mockProcessMessage,
      mockBindIdentity,
      mockResolveIdentityRoute,
      mockResolveEmailBookingContext,
      mockBookingContextToFields,
      mockDecideAutopilot,
      mockCanClassifyInbound,
      mockGetSession,
      mockAppendSession,
      mockCreateReview,
      mockNotifyOperator,
      mockAuditDecision,
    ]) {
      mock.mockReset();
    }

    mockProcessMessage.mockResolvedValue({
      outcome: ProcessOutcome.Replied,
      reply: GENERIC_CLARIFICATION,
    });
    mockBindIdentity.mockResolvedValue({
      role: 'guest',
      entityType: 'reservation',
      entityId: 'reservation-1',
      guestId: 'guest-1',
      reservationId: 'reservation-1',
      propertyId: 'test-prop-tg-live',
      confidence: 0.99,
      status: 'resolved',
      reason: 'email_contact_match',
      resolutionPath: ['tg_contacts:email', 'reservation:matched'],
    });
    mockResolveEmailBookingContext.mockResolvedValue({
      booking_resolved: true,
      property_resolved: true,
      property: {
        object_id: 'test-prop-tg-live',
        checkout_time: '12:00',
        communication_autopilot: 'manual',
      },
      booking: { booking_id: 'reservation-1' },
    });
    mockBookingContextToFields.mockReturnValue({
      booking: { id: 'reservation-1', checkoutTime: '12:00', verified: true },
      object: { id: 'test-prop-tg-live' },
      bookingVerified: true,
      propertyResolved: true,
    });
    mockCanClassifyInbound.mockReturnValue(true);
    mockDecideAutopilot.mockReturnValue({
      action: 'auto_reply',
      confidence: 0.86,
      replyText: GROUNDED_CHECKOUT,
      metadata: {
        intent: 'checkout',
        matchedSignals: ['выезд'],
        missingContext: [],
        contextKeys: ['booking.checkoutTime'],
        channelMode: 'foundation',
        urgent: false,
        policy: 'deterministic_mvp_v1',
      },
    });
    mockGetSession.mockReturnValue({
      session: session(),
      key: 'email:project.ayfaar@gmail.com',
    });
    mockAppendSession.mockImplementation(({ session: current }) => current);
    mockCreateReview.mockReturnValue({ reviewId: 'review-grounded-email' });
    mockNotifyOperator.mockResolvedValue('telegram');
  });

  it('replaces a stale booking clarification with the grounded 12:00 checkout draft', async () => {
    const result = await processEmailInbound({
      payload: {
        from: 'project.ayfaar@gmail.com',
        subject: 'выезд',
        text: 'Во сколько у меня выезд?',
        messageId: '<grounded-checkout@example.com>',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.outboundMode).toBe('draft_only');
    expect(result.orchestrator?.outcome).toBe(ProcessOutcome.Replied);
    expect(result.orchestrator?.reply).toContain('12:00');
    expect(result.orchestrator?.reply).not.toContain('это про какой объект');

    expect(mockResolveEmailBookingContext).toHaveBeenCalledWith(
      expect.objectContaining({
        guest_email: 'project.ayfaar@gmail.com',
        text: 'Во сколько у меня выезд?',
      }),
    );
    expect(mockCanClassifyInbound).toHaveBeenCalledWith(
      expect.objectContaining({ communication_autopilot: 'manual' }),
    );
    expect(mockDecideAutopilot).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        messageText: 'Во сколько у меня выезд?',
        context: expect.objectContaining({
          booking: expect.objectContaining({ checkoutTime: '12:00' }),
          object: expect.objectContaining({ id: 'test-prop-tg-live' }),
        }),
      }),
    );
    expect(mockCreateReview).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        suggestedReply: expect.stringContaining('12:00'),
      }),
    );
    expect(mockNotifyOperator).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('12:00') }),
    );
    expect(mockAuditDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('email_draft_only_grounded_reply_recovered intent=checkout'),
      }),
    );
  });

  it('does not bypass an object whose communication mode is off', async () => {
    mockCanClassifyInbound.mockReturnValue(false);

    const result = await processEmailInbound({
      payload: {
        from: 'project.ayfaar@gmail.com',
        subject: 'выезд',
        text: 'Во сколько у меня выезд?',
        messageId: '<grounded-checkout-off@example.com>',
      },
    });

    expect(result.orchestrator?.reply).toBe(GENERIC_CLARIFICATION);
    expect(mockDecideAutopilot).not.toHaveBeenCalled();
    expect(mockCreateReview).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedReply: GENERIC_CLARIFICATION }),
    );
  });
});
