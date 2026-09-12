import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  createReview: vi.fn(),
  closeReview: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mocks.from(...args),
    rpc: (...args: unknown[]) => mocks.rpc(...args),
  },
}));

vi.mock('../operator-review', () => ({
  createOrUpdateEscalationReview: (...args: unknown[]) => mocks.createReview(...args),
  forceCloseActiveReviewForSession: (...args: unknown[]) => mocks.closeReview(...args),
}));

import {
  claimTelegramInboundReceipt,
  claimTelegramInboundReceiptForRetry,
  completeTelegramInboundReceipt,
  failTelegramInboundReceipt,
} from '../telegram-inbound-receipts';
import type { TelegramUpdate } from '../types';

const update: TelegramUpdate = {
  update_id: 7001,
  message: {
    message_id: 81,
    chat: { id: 9001 },
    from: { id: 9001, first_name: 'Гость', language_code: 'ru' },
    text: 'Не работает код',
  },
};

function queryResult(data: Record<string, unknown> | null) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn().mockResolvedValue({ data: data ? [data] : [], error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return query;
}

describe('durable Telegram inbound receipts', () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.rpc.mockReset();
    mocks.createReview.mockReset();
    mocks.closeReview.mockReset();
    mocks.createReview.mockReturnValue({ reviewId: 'review-1' });
  });

  it('claims one receipt with server-resolved property and account scope', async () => {
    mocks.from
      .mockReturnValueOnce(queryResult({ property_id: '11111111-1111-4111-8111-111111111111' }))
      .mockReturnValueOnce(queryResult({ account_id: 'account-a' }));
    mocks.rpc.mockResolvedValue({
      data: [{
        action: 'process', receipt_id: 'receipt-1', claim_token: 'claim-1', retry_count: 0,
        account_id: 'account-a', property_id: '11111111-1111-4111-8111-111111111111', payload: update,
      }],
      error: null,
    });

    const claim = await claimTelegramInboundReceipt(update);

    expect(claim).toMatchObject({
      action: 'process', receiptId: 'receipt-1', retryCount: 0,
      scope: { accountId: 'account-a', propertyId: '11111111-1111-4111-8111-111111111111' },
    });
    expect(mocks.rpc).toHaveBeenCalledWith('claim_telegram_inbound_receipt', expect.objectContaining({
      p_bot_scope: 'core', p_update_id: 7001, p_chat_id: 9001,
      p_account_id: 'account-a', p_property_id: '11111111-1111-4111-8111-111111111111',
    }));
  });

  it('resolves a text property only through the server-owned Telegram reservation binding', async () => {
    mocks.from
      .mockReturnValueOnce(queryResult({
        property_id: 'test-prop-tg-live',
        conversation_context_v1: {
          current_object: { property_id: 'test-prop-tg-live' },
          current_booking: { reservation_id: 'reservation-1' },
        },
      }))
      .mockReturnValueOnce(queryResult({
        id: 'booking-record-1',
        booking_id: 'reservation-1',
        account_id: 'account-a',
        property_id: 'test-prop-tg-live',
      }))
      .mockReturnValueOnce(queryResult(null))
      .mockReturnValueOnce(queryResult({
        id: 'reservation-1',
        property_id: 'test-prop-tg-live',
      }))
      .mockReturnValueOnce(queryResult({
        legacy_property_id: 'test-prop-tg-live',
        account_id: 'account-a',
        canonical_property_id: '22222222-2222-4222-8222-222222222222',
      }))
      .mockReturnValueOnce(queryResult(null))
      .mockReturnValueOnce(queryResult(null))
      .mockReturnValueOnce(queryResult({ account_id: 'account-a' }));
    mocks.rpc.mockResolvedValue({
      data: [{
        action: 'process', receipt_id: 'receipt-1', claim_token: 'claim-1', retry_count: 0,
        account_id: 'account-a', property_id: 'test-prop-tg-live', payload: update,
      }],
      error: null,
    });

    const claim = await claimTelegramInboundReceipt(update);

    expect(claim).toMatchObject({
      action: 'process',
      scope: { accountId: 'account-a', propertyId: 'test-prop-tg-live' },
    });
    expect(mocks.rpc).toHaveBeenCalledWith('claim_telegram_inbound_receipt', expect.objectContaining({
      p_account_id: 'account-a',
      p_property_id: 'test-prop-tg-live',
    }));
  });

  it('fails a manual recovery claim closed on a mismatched tenant scope', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'telegram_inbound_receipt_scope_mismatch' },
    });

    await expect(claimTelegramInboundReceiptForRetry({
      receiptId: 'receipt-1',
      expectedAccountId: 'account-b',
      expectedPropertyId: 'property-b',
    })).rejects.toThrow('telegram_inbound_receipt_scope_mismatch');
  });

  it('marks a processing failure retryable and creates one existing-queue operator review', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const claim = {
      action: 'process' as const,
      receiptId: 'receipt-1',
      claimToken: 'claim-1',
      retryCount: 0,
      scope: { accountId: 'account-a', propertyId: 'property-a' },
      update,
    };

    await failTelegramInboundReceipt({ claim, failureCode: 'process_outcome_error' });

    expect(mocks.createReview).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'telegram_inbound_failure:receipt-1',
      propertyId: 'property-a',
      escalationReason: 'INBOUND_PROCESSING_FAILED',
      source: expect.objectContaining({ receipt_id: 'receipt-1', update_id: 7001 }),
    }));
    expect(mocks.rpc).toHaveBeenCalledWith('complete_telegram_inbound_receipt', expect.objectContaining({
      p_receipt_id: 'receipt-1', p_status: 'failed', p_failure_code: 'process_outcome_error',
      p_operator_review_id: 'review-1',
    }));
  });

  it('marks a recovered retry processed and closes its failure review', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const claim = {
      action: 'process' as const,
      receiptId: 'receipt-1',
      claimToken: 'claim-2',
      retryCount: 1,
      scope: { accountId: 'account-a', propertyId: 'property-a' },
      update,
    };

    await completeTelegramInboundReceipt({ claim, outcome: 'replied' });

    expect(mocks.rpc).toHaveBeenCalledWith('complete_telegram_inbound_receipt', expect.objectContaining({
      p_receipt_id: 'receipt-1', p_status: 'processed', p_process_outcome: 'replied',
    }));
    expect(mocks.closeReview).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'telegram_inbound_failure:receipt-1',
    }));
  });
});
