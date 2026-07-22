/**
 * Unit tests for communication → OPS escalation helper.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestOperatorHandoff: vi.fn(),
  supabaseUpdate: vi.fn(),
}));

vi.mock('../handoff-lock', () => ({
  requestOperatorHandoff: mocks.requestOperatorHandoff,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: unknown) => ({
        eq: async () => mocks.supabaseUpdate(patch),
      }),
    }),
  },
}));

import { recordCommunicationEscalation } from '../escalations';

describe('recordCommunicationEscalation', () => {
  beforeEach(() => {
    mocks.requestOperatorHandoff.mockReset();
    mocks.supabaseUpdate.mockReset();
    mocks.supabaseUpdate.mockResolvedValue({ error: null });
    mocks.requestOperatorHandoff.mockReturnValue({
      reviewId: 'rev-acceptance-1',
      alreadyLocked: false,
      state: 'operator_requested',
      review: {
        reviewId: 'rev-acceptance-1',
        sessionId: 'sess-1',
        status: 'pending',
        escalationReason: 'operator_required',
        createdAt: '2026-06-22T10:00:00Z',
        updatedAt: '2026-06-22T10:00:00Z',
      },
    });
  });

  it('creates escalation review without direct OPS task creation', async () => {
    const result = await recordCommunicationEscalation({
      sessionId: 'sess-1',
      channel: 'telegram',
      targetId: '12345',
      contactId: 'contact-1',
      objectId: 'OBJ-1',
      messageText: 'Помогите с замком',
      reason: 'low_confidence',
      source: 'communication_autopilot',
    });

    expect(result.review.reviewId).toBe('rev-acceptance-1');
    expect(mocks.requestOperatorHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        leadId: 'contact-1',
        propertyId: 'OBJ-1',
        escalationReason: 'low_confidence',
        chatId: 12345,
      }),
    );
    expect(mocks.supabaseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        communication_status: 'needs_manual_reaction',
      }),
    );
  });

  it('marks has_problem for complaint reasons', async () => {
    await recordCommunicationEscalation({
      sessionId: 'sess-2',
      channel: 'telegram',
      targetId: '99',
      contactId: 'contact-2',
      messageText: 'Жалоба на грязь',
      reason: 'complaint',
      source: 'telegram',
    });

    expect(mocks.supabaseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        communication_status: 'has_problem',
      }),
    );
  });

  it('skips CRM update when contactId is missing', async () => {
    await recordCommunicationEscalation({
      sessionId: 'sess-3',
      channel: 'telegram',
      targetId: '77',
      messageText: 'Нужен оператор',
      reason: 'operator_required',
      source: 'telegram',
    });

    expect(mocks.supabaseUpdate).not.toHaveBeenCalled();
  });
});
