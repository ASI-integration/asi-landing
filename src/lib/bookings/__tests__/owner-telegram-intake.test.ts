import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundMessageEnvelope } from '@/lib/communication/types';

const processInboundBookingRequest = vi.fn();

vi.mock('@/lib/booking-ops/real-booking-intake-autopilot', () => ({
  processInboundBookingRequest: (...args: unknown[]) => processInboundBookingRequest(...args),
}));

vi.mock('@/lib/communication/telegram-owner-object-session', () => ({
  listOwnerObjectRecords: vi.fn(() => []),
}));

function envelope(messageText: string, metadata: Record<string, unknown> = {}): InboundMessageEnvelope {
  return {
    channel: 'telegram',
    externalUserId: '9001',
    chatId: '9001',
    messageText,
    receivedAt: new Date('2026-07-10T10:00:00.000Z'),
    update_id: 123,
    metadata: {
      telegram_chat_id: '9001',
      telegram_user_id: 9001,
      telegram_username: 'owner_user',
      providerMessageId: 'message:77:original',
      inboundIdempotencyKey: 'telegram:message:9001:77:original',
      senderIdentity: 'owner',
      ...metadata,
    },
  };
}

describe('owner Telegram booking intake', () => {
  beforeEach(() => {
    processInboundBookingRequest.mockReset();
    processInboundBookingRequest.mockResolvedValue({
      intakeId: 'intake-1',
      bookingId: 'booking-1',
      guestId: 'guest-1',
      intakeStatus: 'processed',
      initializedModules: ['guest_intake_autopilot'],
      createdCommunicationIntents: [],
      missingRequiredFields: [],
      nextRequiredActions: ['continue_intake_flow'],
      fallbackCreated: false,
      duplicateOfBookingId: null,
      safeSummary: 'ok',
    });
  });

  it('routes clear owner booking text to modern intake', async () => {
    const { tryTelegramOwnerBookingIntake } = await import('../owner-telegram-intake');

    const result = await tryTelegramOwnerBookingIntake({
      chatId: 9001,
      envelope: envelope('Гость Иван, +7 999 111-22-33, заезд 10.08, выезд 12.08, объект: Студия'),
      knownProperties: [{ propertyId: 'OBJ-1', label: 'Студия' }],
    });

    expect(result.handled).toBe(true);
    expect(result.bookingId).toBe('booking-1');
    expect(processInboundBookingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        guestName: 'Иван',
        guestPhone: '+79991112233',
        propertyId: 'OBJ-1',
        sourceMessageId: 'telegram:message:9001:77:original',
        rawMessageText: expect.stringContaining('Гость Иван'),
      }),
      'telegram',
    );
  });

  it('does not route non-booking owner text to modern intake', async () => {
    const { tryTelegramOwnerBookingIntake } = await import('../owner-telegram-intake');

    const result = await tryTelegramOwnerBookingIntake({
      chatId: 9001,
      envelope: envelope('Нужно проверить Wi-Fi в квартире'),
      knownProperties: [{ propertyId: 'OBJ-1', label: 'Студия' }],
    });

    expect(result.handled).toBe(false);
    expect(processInboundBookingRequest).not.toHaveBeenCalled();
  });

  it('does not route guest support text to modern intake', async () => {
    const { tryTelegramOwnerBookingIntake } = await import('../owner-telegram-intake');

    const result = await tryTelegramOwnerBookingIntake({
      chatId: 9001,
      envelope: envelope('Я гость, не работает Wi-Fi', { senderIdentity: 'guest' }),
      knownProperties: [{ propertyId: 'OBJ-1', label: 'Студия' }],
    });

    expect(result.handled).toBe(false);
    expect(processInboundBookingRequest).not.toHaveBeenCalled();
  });

  it('keeps partial booking data in the modern missing-data path', async () => {
    processInboundBookingRequest.mockResolvedValueOnce({
      intakeId: 'intake-partial',
      bookingId: 'booking-partial',
      guestId: null,
      intakeStatus: 'needs_review',
      initializedModules: ['guest_intake_autopilot'],
      createdCommunicationIntents: [],
      missingRequiredFields: ['property', 'guest_count'],
      nextRequiredActions: ['attach_property'],
      fallbackCreated: false,
      duplicateOfBookingId: null,
      safeSummary: 'needs review',
    });
    const { tryTelegramOwnerBookingIntake } = await import('../owner-telegram-intake');

    const result = await tryTelegramOwnerBookingIntake({
      chatId: 9001,
      envelope: envelope('Бронь: гость Мария, заезд 10.08, выезд 12.08'),
      knownProperties: [],
    });

    expect(result.handled).toBe(true);
    expect(result.bookingId).toBe('booking-partial');
    expect(result.replyText).toContain('property');
    expect(processInboundBookingRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        guestName: 'Мария',
        propertyId: null,
        metadata: expect.objectContaining({ ownerTelegramBookingSignal: true }),
      }),
      'telegram',
    );
  });
});
