import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mockProcessMessage = vi.fn().mockResolvedValue({ outcome: 'replied', reply: 'Operator draft' });

vi.mock('../orchestrator', () => ({
  processMessage: (...args: unknown[]) => mockProcessMessage(...args),
}));

vi.mock('../identity-binding', () => ({
  bindIdentity: async () => ({
    role: 'guest',
    entityType: 'unknown',
    entityId: 'phone-guest',
    propertyId: undefined,
    reservationId: undefined,
    leadId: undefined,
    guestId: 'phone-guest',
    confidence: 0.55,
    status: 'unresolved',
    reason: 'phone-test',
  }),
}));

import { normalizePhoneWebhookPayload } from '../channels/phone';
import { processPhoneCallEvent } from '../phone-support';
import { _resetForTesting as resetIdempotency } from '../idempotency';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests, listEscalationReviews } from '../operator-review';

function phoneEvent(payload: Record<string, unknown>) {
  const normalized = normalizePhoneWebhookPayload({
    provider: 'generic-test',
    timestamp: '2026-05-08T10:00:00.000Z',
    ...payload,
  });
  if (!normalized.supported) throw new Error(`unsupported test payload: ${normalized.reason}`);
  return normalized.event;
}

describe('Phone support Phase 1 processing', () => {
  beforeEach(() => {
    resetIdempotency();
    __resetConversationSessionEngineForTests();
    __resetEscalationReviewStoreForTests();
    mockProcessMessage.mockClear();
    mockProcessMessage.mockResolvedValue({ outcome: 'replied', reply: 'Operator draft' });
  });

  it('creates an operator/dashboard item for a missed call without transcript', async () => {
    const result = await processPhoneCallEvent(phoneEvent({
      event: 'call_missed',
      call_id: 'missed-1',
      from: '+15550001111',
      to: '+15550002222',
    }));

    const reviews = listEscalationReviews();

    expect(result.ok).toBe(true);
    expect(result.reviewId).toBeTruthy();
    expect(mockProcessMessage).not.toHaveBeenCalled();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toEqual(
      expect.objectContaining({
        channel: 'phone',
        targetId: '+15550001111',
        escalationReason: 'PHONE_CALL_MISSED',
      }),
    );
    expect(reviews[0].source).toEqual(
      expect.objectContaining({
        source: 'phone_call',
        eventType: 'call_missed',
        callStatus: 'missed',
        callerPhoneNumber: '+15550001111',
      }),
    );
  });

  it('routes phone transcripts into the shared orchestrator path', async () => {
    const event = phoneEvent({
      event: 'call_transcribed',
      call_id: 'transcript-1',
      from: '+15550003333',
      to: '+15550002222',
      transcript: 'Где пароль от Wi-Fi?',
    });

    const result = await processPhoneCallEvent(event);
    const reviews = listEscalationReviews();

    expect(result.ok).toBe(true);
    expect(mockProcessMessage).toHaveBeenCalledTimes(1);
    expect(mockProcessMessage.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        channel: 'phone',
        externalUserId: '+15550003333',
        phoneNumber: '+15550003333',
        messageText: 'Где пароль от Wi-Fi?',
      }),
    );
    expect(reviews).toHaveLength(1);
    expect(reviews[0].suggestedReply).toBe('Operator draft');
    expect(reviews[0].source).toEqual(
      expect.objectContaining({
        source: 'phone_call',
        transcriptText: 'Где пароль от Wi-Fi?',
        transcriptProcessed: true,
        orchestratorOutcome: 'replied',
      }),
    );
  });

  it('does not create duplicate audit/escalation spam for duplicate call events', async () => {
    const event = phoneEvent({
      event: 'call_missed',
      call_id: 'duplicate-1',
      from: '+15550004444',
      to: '+15550002222',
    });

    const first = await processPhoneCallEvent(event);
    const second = await processPhoneCallEvent(event);

    expect(first.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(listEscalationReviews()).toHaveLength(1);
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it('includes phone as a communication dashboard channel filter', () => {
    const pageSource = readFileSync(join(process.cwd(), 'src/app/dashboard/communication/page.tsx'), 'utf8');

    expect(pageSource).toContain("{ key: 'phone', label: 'Phone'");
    expect(pageSource).toContain("review.channel === 'phone'");
    expect(pageSource).toContain('Caller phone');
    expect(pageSource).toContain('Open recording');
  });
});
