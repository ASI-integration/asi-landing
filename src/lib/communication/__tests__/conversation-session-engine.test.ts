import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetConversationSessionEngineForTests,
  appendSessionMessage,
  buildSessionContextForLLM,
  getOrCreateConversationSession,
  transitionConversationSessionState,
  updateSessionFactsAndSummary,
} from '../conversation-session-engine';
import type { InboundMessageEnvelope } from '../types';

function makeEnvelope(overrides?: Partial<InboundMessageEnvelope>): InboundMessageEnvelope {
  return {
    channel: 'telegram',
    externalUserId: 'u_1',
    chatId: '42',
    messageText: 'hello',
    receivedAt: new Date(),
    update_id: 1,
    ...overrides,
  };
}

describe('conversation-session-engine', () => {
  beforeEach(() => __resetConversationSessionEngineForTests());

  it('creates a session on first inbound and reuses it on next inbound', () => {
    const env = makeEnvelope();
    const first = getOrCreateConversationSession({ envelope: env, identity: undefined });
    expect(first.created).toBe(true);
    const second = getOrCreateConversationSession({ envelope: env, identity: undefined });
    expect(second.created).toBe(false);
    expect(second.session.sessionId).toBe(first.session.sessionId);
  });

  it('accumulates memory (lastMessages) and persists extracted facts + summary', () => {
    const env = makeEnvelope({ messageText: 'We arrive 2026-05-01, 2 guests, parking please' });
    const { session: s0, key } = getOrCreateConversationSession({ envelope: env, identity: undefined });
    const s1 = appendSessionMessage({ key, session: s0, direction: 'inbound', content: env.messageText! });
    const s2 = updateSessionFactsAndSummary({ key, session: s1, text: env.messageText! });
    expect(s2.memory.lastMessages.length).toBe(1);
    expect(s2.memory.extractedFacts.guest_count).toBe(2);
    expect(s2.memory.extractedFacts.requested_dates).toContain('2026-05-01');
    expect(s2.memory.extractedFacts.parking).toBe(true);
    expect(typeof s2.memory.summary).toBe('string');
    expect(s2.memory.summary!.length).toBeGreaterThan(0);
  });

  it('injects session context into LLM block', () => {
    const env = makeEnvelope({ messageText: 'need invoice for payment' });
    const { session: s0, key } = getOrCreateConversationSession({ envelope: env, identity: undefined });
    const s1 = appendSessionMessage({ key, session: s0, direction: 'inbound', content: env.messageText! });
    const s2 = updateSessionFactsAndSummary({ key, session: s1, text: env.messageText! });
    const block = buildSessionContextForLLM(s2);
    expect(block).toContain('--- Session Context ---');
    expect(block).toContain('state:');
    expect(block).toContain('lastMessages:');
    expect(block).toContain('payment');
  });

  it('allows valid state transitions and blocks invalid ones', () => {
    const env = makeEnvelope();
    const { session: s0 } = getOrCreateConversationSession({ envelope: env, identity: undefined });
    const s1 = transitionConversationSessionState(s0, 'awaiting_input', 'need_details');
    expect(s1.state).toBe('awaiting_input');
    const s2 = transitionConversationSessionState(s1, 'resolved', 'done');
    expect(s2.state).toBe('resolved');
    const s3 = transitionConversationSessionState(s2, 'escalated', 'should_not_jump');
    // resolved -> escalated is not allowed by our minimal machine; should stay resolved
    expect(s3.state).toBe('resolved');
  });
});

