import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessMessage = vi.fn();
const mockNotifyOperator = vi.fn();
const mockCreateReview = vi.fn();
const mockBindIdentity = vi.fn();
const mockGetSession = vi.fn();
const mockAppendSession = vi.fn();

vi.mock('../orchestrator', () => ({
  processMessage: (...args: unknown[]) => mockProcessMessage(...args),
}));

vi.mock('../operator-notify', () => ({
  notifyOperator: (...args: unknown[]) => mockNotifyOperator(...args),
}));

vi.mock('../identity-binding', () => ({
  bindIdentity: (...args: unknown[]) => mockBindIdentity(...args),
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

vi.mock('../audit', () => ({
  auditInbound: vi.fn(),
  auditDecision: vi.fn(),
}));

vi.mock('../idempotency', () => ({
  checkAndMarkKey: vi.fn(() => false),
}));

import { EmailAdapter } from '../channels/email';
import { processEmailInbound, buildEmailDraftNotification } from '../email-inbound-processor';
import {
  lookup_booking_by_email,
  resolveEmailGuestBookingObjectContext,
} from '../telegram-booking-object-memory';
import { decideCommunicationAutopilotResponse } from '../autopilot';

describe('email communication MVP', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockProcessMessage.mockReset();
    mockNotifyOperator.mockReset();
    mockCreateReview.mockReset();
    mockBindIdentity.mockReset();
    mockGetSession.mockReset();
    mockAppendSession.mockReset();

    mockProcessMessage.mockResolvedValue({
      outcome: 'replied',
      reply: 'Чтобы отправить данные Wi‑Fi, уточните номер брони или телефон из бронирования.',
    });
    mockBindIdentity.mockResolvedValue({
      role: 'guest',
      entityType: 'guest',
      entityId: 'guest-email',
      confidence: 1,
      status: 'resolved',
      guestId: 'guest-email',
    });
    mockGetSession.mockReturnValue({
      session: {
        sessionId: 'sess-email-1',
        actorId: 'guest@example.com',
        role: 'guest',
        confidence: 1,
        memory: { lastMessages: [] },
      },
      key: 'email:guest@example.com',
    });
    mockAppendSession.mockImplementation(({ session }) => session);
    mockCreateReview.mockReturnValue({ reviewId: 'review-email-1' });
    mockNotifyOperator.mockResolvedValue('telegram');
  });

  it('normalizes inbound email through EmailAdapter', async () => {
    const adapter = new EmailAdapter();
    const envelope = await adapter.normalizeInbound({
      from: 'Guest <guest@example.com>',
      subject: 'Wi-Fi',
      text: 'Где пароль от Wi-Fi?',
      messageId: '<mvp-1@example.com>',
    });

    expect(envelope.channel).toBe('email');
    expect(envelope.externalUserId).toBe('guest@example.com');
    expect(envelope.messageText).toBe('Где пароль от Wi-Fi?');
  });

  it('processEmailInbound stores operator draft and notifies without SMTP send by default', async () => {
    const result = await processEmailInbound({
      payload: {
        from: 'guest@example.com',
        subject: 'Wi-Fi question',
        text: 'Где пароль от Wi-Fi?',
        messageId: '<mvp-draft-1@example.com>',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.outboundMode).toBe('draft_only');
    expect(result.reviewId).toBe('review-email-1');
    expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    expect(mockCreateReview).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        targetId: 'guest@example.com',
        suggestedReply: expect.stringMatching(/wi‑fi|брони/i),
      }),
    );
    expect(mockNotifyOperator).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('[Email draft]'),
        body: expect.stringMatching(/Suggested reply draft:/i),
      }),
    );
  });

  it('lookup_booking_by_email resolves booking via tg_guest_identities', async () => {
    const db = {
      from: (table: string) => {
        const q: any = {
          _table: table,
          _filters: [] as Array<{ col: string; val: unknown }>,
          _limit: null as number | null,
          select: () => q,
          eq: (col: string, val: unknown) => {
            q._filters.push({ col, val });
            return q;
          },
          order: () => q,
          limit: (n: number) => {
            q._limit = n;
            return q;
          },
          then: (resolve: (v: unknown) => void) => {
            const rows =
              table === 'tg_guest_identities'
                ? [{ guest_id: 'guest-1', email: 'guest@example.com' }]
                : table === 'tg_guest_reservations'
                  ? [
                      {
                        id: 'res-1',
                        booking_id: 'BK-EMAIL-001',
                        property_id: 'prop-1',
                        guest_id: 'guest-1',
                        guest_name: 'Guest',
                        status: 'confirmed',
                        check_in: '2026-05-30T00:00:00Z',
                        check_out: '2026-06-02T00:00:00Z',
                      },
                    ]
                  : [];
            resolve({ data: rows.slice(0, q._limit ?? rows.length) });
          },
        };
        return q;
      },
    };

    const booking = await lookup_booking_by_email({ email: 'guest@example.com', db });
    expect(booking?.booking_id).toBe('BK-EMAIL-001');
    expect(booking?.object_id).toBe('prop-1');
  });

  it('does not invent Wi-Fi without verified booking/object context', async () => {
    const ctx = await resolveEmailGuestBookingObjectContext({
      guest_email: 'unknown@example.com',
      text: 'Где Wi-Fi?',
      db: {
        from: () => ({
          select: () => ({
            eq: () => ({
              limit: () => ({ maybeSingle: async () => ({ data: null }) }),
            }),
          }),
        }),
      } as any,
    });

    const decision = decideCommunicationAutopilotResponse({
      channel: 'email',
      messageText: 'Где пароль от Wi-Fi?',
      context: {
        session: { language: 'ru' },
        bookingVerified: ctx.wifi_verified,
        propertyResolved: ctx.property_resolved,
      },
    });

    expect(decision.metadata.intent).toBe('wifi');
    expect(decision.action).toBe('needs_context');
    expect(decision.replyText ?? '').not.toMatch(/пароль:\s*\S+/i);
  });

  it('buildEmailDraftNotification includes draft body and source key', () => {
    const notification = buildEmailDraftNotification({
      from: 'guest@example.com',
      subject: 'Access issue',
      replyDraft: 'Срочно передаю оператору.',
      escalation: 'urgent_access_problem',
      reviewId: 'review-1',
      outboundMode: 'draft_only',
    });

    expect(notification.subject).toContain('[Email draft]');
    expect(notification.body).toContain('guest@example.com');
    expect(notification.body).toContain('Срочно передаю оператору.');
    expect(notification.sourceKey).toBe('email:guest@example.com');
  });
});
