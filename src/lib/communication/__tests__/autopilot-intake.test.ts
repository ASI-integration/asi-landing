import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundMessageEnvelope } from '../types';

const mockSendMessage = vi.fn().mockResolvedValue(true);
const mockCallLLM = vi.fn().mockResolvedValue('LLM should not be used');

function supabaseQuery() {
  const query: any = {
    upsert: vi.fn(async () => ({ data: null, error: null })),
    insert: vi.fn(async () => ({ data: null, error: null })),
    update: vi.fn(() => query),
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    lt: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    single: vi.fn(async () => ({ data: null, error: null })),
  };
  return query;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => supabaseQuery(),
  },
}));

vi.mock('../channels', () => ({
  getChannelAdapter: () => ({
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    formatResponse: (rawMessage: string) => rawMessage,
  }),
}));

vi.mock('@/lib/openai', () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}));

vi.mock('../intent', () => ({
  detectIntent: async () => ({ intent: 'general_question', confidence: 0.95 }),
}));

vi.mock('../classifier', () => ({
  classifyMessage: async () => ({
    category: 'guest-message',
    lang: 'ru',
    slots: { isUrgent: false, isAccessRelated: false, mentionsGuest: false, mentionsTime: false, mentionsObject: false },
  }),
  classify: () => ({
    category: 'guest-message',
    lang: 'ru',
    slots: { isUrgent: false, isAccessRelated: false, mentionsGuest: false, mentionsTime: false, mentionsObject: false },
  }),
  extractSlots: () => ({
    isUrgent: false,
    isAccessRelated: false,
    mentionsGuest: false,
    mentionsTime: false,
    mentionsObject: false,
  }),
  deterministicReply: () => 'fallback',
  buildIntelligentPrompt: () => 'prompt',
  SYSTEM_PROMPT: 'SYSTEM',
}));

vi.mock('../identity-binding', () => ({
  bindIdentity: async (envelope: InboundMessageEnvelope) => ({
    role: 'guest',
    entityType: 'reservation',
    entityId: 'reservation-1',
    propertyId: 'object-1',
    reservationId: 'booking-1',
    leadId: null,
    confidence: 1,
    status: 'resolved',
    reason: 'autopilot-intake-test',
    guestId: envelope.externalUserId,
  }),
}));

vi.mock('../context', () => ({
  buildCommunicationContext: async () => ({
    memory: {},
    intentResult: { intent: 'general_question', confidence: 0.95 },
    reservation: {
      status: 'matched',
      confidence: 1,
      reservationId: 'booking-1',
      propertyId: 'object-1',
      guestName: 'Guest',
    },
    knowledge: {
      universalPolicy: 'Never invent details.',
      checkInInstructions: 'Information unavailable.',
      checkOutInstructions: 'Information unavailable.',
      wifiInstructions: 'Information unavailable.',
    },
    recentMessages: [],
  }),
}));

vi.mock('../scenario-engine', () => ({
  buildDecisionAndPlan: () => ({
    decision: {
      scenario: 'checkin_checkout_question',
      confidence: 0.8,
      requiredFacts: ['object'],
      knownFacts: {},
      missingFacts: ['object'],
      entityResolution: { status: 'unresolved' },
      nextAction: 'ask_clarifying_question',
      reason: 'missing object context',
    },
    plan: {
      scenario: 'checkin_checkout_question',
      resolvedEntities: {},
      knownFacts: {},
      missingFacts: ['object'],
      allowedClaims: [],
      forbiddenAssumptions: ['access instructions'],
      deterministicFirst: true,
      llmAssistedWording: false,
      clarifyingQuestion: {
        ru: 'Уточните, пожалуйста, объект или номер брони.',
        en: 'Please send the property or booking number.',
      },
    },
  }),
}));

vi.mock('../entity-resolver', () => ({
  resolveEntities: () => ({ status: 'unresolved' }),
}));

vi.mock('../templates', () => ({
  getPropertyTemplates: async () => null,
}));

vi.mock('../background', () => ({
  runInBackground: () => undefined,
}));

vi.mock('@/lib/ops/checkin-gate', () => ({
  evaluateCheckinReadiness: async () => ({ allowed: false, blocked_reason: 'not_needed', checked_at: new Date().toISOString() }),
}));

vi.mock('@/lib/ops/tasks', () => ({
  OpsTaskType: { GuestIssue: 'guest_issue', Checkout: 'checkout', CheckinReady: 'checkin_ready' },
  OpsTaskPriority: { Normal: 'normal', Urgent: 'urgent' },
  createOpsTask: async () => ({ task_id: 'task-1', error: null }),
}));

vi.mock('@/lib/payments/factory', () => ({
  createPaymentRequest: async () => ({ paymentUrl: 'https://pay.test/mock' }),
}));

vi.mock('../telegram-session-memory', () => ({
  processTelegramOperationalIntakeWithSessionMemory: async () => ({ handled: false }),
}));

import { _resetForTesting as resetIdempotency } from '../idempotency';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __resetConversationSessionEngineForTests } from '../conversation-session-engine';
import { __resetEscalationReviewStoreForTests, listEscalationReviews } from '../operator-review';
import { processMessage } from '../orchestrator';

const fullContext = {
  booking: {
    id: 'booking-1',
    checkoutTime: '12:00',
    earlyCheckInAvailable: false,
    lateCheckoutAvailable: true,
  },
  object: {
    id: 'object-1',
    address: 'Nevsky 24',
    accessInstructions: 'Use the courtyard entrance.',
    accessCode: '2468',
    wifiName: 'ASI Guest',
    wifiPassword: 'welcome24',
  },
};

function envelope(params: {
  channel: 'telegram' | 'email';
  text: string;
  providerMessageId: string;
  autopilotContext?: unknown;
}): InboundMessageEnvelope {
  return {
    channel: params.channel,
    externalUserId: params.channel === 'telegram' ? '42' : 'guest@example.com',
    chatId: params.channel === 'telegram' ? '42' : undefined,
    email: params.channel === 'email' ? 'guest@example.com' : undefined,
    subject: params.channel === 'email' ? 'Guest question' : undefined,
    messageText: params.text,
    receivedAt: new Date('2026-05-25T10:00:00.000Z'),
    update_id: params.providerMessageId.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 1000),
    metadata: {
      providerMessageId: params.providerMessageId,
      externalMessageId: params.providerMessageId,
      autopilotContext: params.autopilotContext,
    },
  };
}

describe('communication autopilot intake wiring', () => {
  beforeEach(() => {
    resetIdempotency();
    __resetAutonomousSessionStoreForTests();
    __resetConversationSessionEngineForTests();
    __resetEscalationReviewStoreForTests();
    mockSendMessage.mockClear();
    mockCallLLM.mockClear();
  });

  it('auto-replies to routine Telegram guest questions when context is available', async () => {
    const result = await processMessage(
      envelope({
        channel: 'telegram',
        text: 'Подскажите пароль от Wi-Fi',
        providerMessageId: 'tg-wifi-1',
        autopilotContext: fullContext,
      }),
    );

    expect(result.outcome).toBe('replied');
    expect(mockSendMessage).toHaveBeenCalledWith(
      '42',
      expect.stringContaining('ASI Guest'),
      expect.objectContaining({ reply_handler: expect.stringContaining('communication_autopilot') }),
    );
    expect(String(mockSendMessage.mock.calls[0][1])).toContain('welcome24');
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('falls back for missing booking or object context instead of inventing details', async () => {
    const result = await processMessage(
      envelope({
        channel: 'telegram',
        text: 'Пришлите адрес и инструкцию для заселения',
        providerMessageId: 'tg-needs-context-1',
      }),
    );

    expect(result.outcome).toBe('replied');
    expect(String(mockSendMessage.mock.calls[0][1])).toContain('объект');
    expect(String(mockSendMessage.mock.calls[0][1])).not.toContain('2468');
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('escalates urgent Telegram access problems prominently', async () => {
    const result = await processMessage(
      envelope({
        channel: 'telegram',
        text: 'Срочно, код не работает, я на улице и не могу попасть',
        providerMessageId: 'tg-urgent-access-1',
        autopilotContext: fullContext,
      }),
    );

    expect(result.outcome).toBe('replied');
    expect(result.escalation?.reason).toBe('URGENT_ISSUE');
    expect(String(mockSendMessage.mock.calls[0][1])).toMatch(/Срочно|оператор|доступ/i);
    expect(listEscalationReviews().length).toBe(1);
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('keeps Email safe while using the same foundation flow when context is present', async () => {
    const result = await processMessage(
      envelope({
        channel: 'email',
        text: 'Подскажите пароль от Wi-Fi',
        providerMessageId: 'email-wifi-1',
        autopilotContext: fullContext,
      }),
    );

    expect(result.outcome).toBe('replied');
    expect(mockSendMessage).toHaveBeenCalledWith(
      'guest@example.com',
      expect.stringContaining('ASI Guest'),
      expect.objectContaining({ subject: 'Re: Guest question' }),
    );
    expect(mockCallLLM).not.toHaveBeenCalled();
  });
});
