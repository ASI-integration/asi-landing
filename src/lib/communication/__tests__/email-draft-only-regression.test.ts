import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessMessage = vi.fn();
const mockBindIdentity = vi.fn();
const mockResolveIdentityRoute = vi.fn();
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

const UNKNOWN_CLARIFICATION = 'Здравствуйте! Вы владелец/управляющий или гость?';

function sessionMessage(providerMessageId: string, content = 'Здравствуйте. Можно задержаться до 15:00?') {
  return {
    id: `message-${providerMessageId}`,
    conversationId: 'sess-email-regression',
    direction: 'inbound',
    type: 'text',
    content,
    meta: {
      providerMessageId,
      externalMessageId: providerMessageId,
      message_id: providerMessageId,
    },
    deliveryStatus: 'pending',
    createdAt: '2026-08-19T19:53:44.912Z',
  };
}

function sessionWithMessages(lastMessages: unknown[]) {
  return {
    sessionId: 'sess-email-regression',
    actorId: 'project.ayfaar@gmail.com',
    role: 'unknown',
    confidence: 0,
    memory: { lastMessages },
  };
}

describe('email draft-only production regressions', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('EMAIL_AUTO_SEND', 'false');
    vi.stubEnv('EMAIL_DRAFT_ONLY', 'true');

    mockProcessMessage.mockReset();
    mockBindIdentity.mockReset();
    mockResolveIdentityRoute.mockReset();
    mockGetSession.mockReset();
    mockAppendSession.mockReset();
    mockCreateReview.mockReset();
    mockNotifyOperator.mockReset();
    mockAuditDecision.mockReset();

    mockProcessMessage.mockResolvedValue({
      outcome: ProcessOutcome.Replied,
      reply: 'Черновик ответа гостю.',
    });
    mockBindIdentity.mockResolvedValue({
      role: 'unknown',
      entityType: 'unknown',
      confidence: 0,
      status: 'unresolved',
      reason: 'no_identity',
      resolutionPath: ['reservation:match:unmatched', 'role:unknown'],
    });
    mockResolveIdentityRoute.mockResolvedValue({
      senderIdentity: 'unknown',
      route: 'unknown_clarify',
      shouldRunGuestConcierge: false,
      replyText: UNKNOWN_CLARIFICATION,
      reason: 'unknown_sender_needs_role',
      audit: {},
    });
    mockGetSession.mockReturnValue({
      session: sessionWithMessages([]),
      key: 'email:project.ayfaar@gmail.com',
    });
    mockAppendSession.mockImplementation(({ session }) => session);
    mockCreateReview.mockReturnValue({ reviewId: 'review-email-regression' });
    mockNotifyOperator.mockResolvedValue('telegram');
  });

  it('recovers unknown identity clarification from draft-only suppression without duplicating inbound memory', async () => {
    const providerMessageId = 'late-checkout-draft-only@example.com';
    mockProcessMessage.mockResolvedValue({
      outcome: ProcessOutcome.Error,
      update_id: 3791056156,
      chat_id: 22063,
    });
    mockGetSession.mockReturnValue({
      session: sessionWithMessages([sessionMessage(providerMessageId)]),
      key: 'email:project.ayfaar@gmail.com',
    });

    const result = await processEmailInbound({
      payload: {
        from: 'project.ayfaar@gmail.com',
        subject: 'Вопрос по позднему выезду',
        text: 'Здравствуйте. Я завтра должен выехать, но хотел бы задержаться до 15:00.\nЭто возможно?',
        messageId: `<${providerMessageId}>`,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.outboundMode).toBe('draft_only');
    expect(result.orchestrator?.outcome).toBe(ProcessOutcome.Replied);
    expect(result.orchestrator?.reply).toBe(UNKNOWN_CLARIFICATION);
    expect(result.reviewId).toBe('review-email-regression');
    expect(mockResolveIdentityRoute).toHaveBeenCalledTimes(1);
    expect(mockAppendSession).not.toHaveBeenCalled();
    expect(mockCreateReview).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        targetId: 'project.ayfaar@gmail.com',
        suggestedReply: UNKNOWN_CLARIFICATION,
        latestMessages: expect.arrayContaining([
          expect.objectContaining({
            direction: 'inbound',
            meta: expect.objectContaining({ providerMessageId }),
          }),
        ]),
      }),
    );
    expect(mockNotifyOperator).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(UNKNOWN_CLARIFICATION),
      }),
    );
    expect(mockAuditDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringContaining('email_draft_only_identity_clarification_recovered'),
      }),
    );
  });

  it('does not dedupe by text alone when provider message ids differ', async () => {
    const previousProviderId = 'previous-message@example.com';
    mockGetSession.mockReturnValue({
      session: sessionWithMessages([
        sessionMessage(previousProviderId, 'Одинаковый текст'),
      ]),
      key: 'email:project.ayfaar@gmail.com',
    });

    await processEmailInbound({
      payload: {
        from: 'project.ayfaar@gmail.com',
        subject: 'Повтор текста',
        text: 'Одинаковый текст',
        messageId: '<new-message@example.com>',
      },
    });

    expect(mockAppendSession).toHaveBeenCalledTimes(1);
  });

  it('does not mask a real processing/delivery error when auto-send is enabled', async () => {
    vi.stubEnv('EMAIL_AUTO_SEND', 'true');
    vi.stubEnv('EMAIL_DRAFT_ONLY', 'false');
    mockProcessMessage.mockResolvedValue({
      outcome: ProcessOutcome.Error,
      update_id: 77,
      chat_id: 88,
    });

    const result = await processEmailInbound({
      payload: {
        from: 'guest@example.com',
        subject: 'Live send failure',
        text: 'Test',
        messageId: '<live-send-failure@example.com>',
      },
    });

    expect(result.orchestrator?.outcome).toBe(ProcessOutcome.Error);
    expect(mockResolveIdentityRoute).not.toHaveBeenCalled();
    expect(mockNotifyOperator).not.toHaveBeenCalled();
    expect(mockCreateReview).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedReply: undefined }),
    );
  });
});
