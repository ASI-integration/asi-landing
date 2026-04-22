import { describe, it, expect } from 'vitest';
import { buildDecisionAndPlan } from '../scenario-engine';
import { resolveEntities } from '../entity-resolver';
import type { CommunicationContext, IdentityResolution, IntentResult } from '../types';

function ctx(params: Partial<CommunicationContext> = {}): CommunicationContext {
  return {
    chatId: 1,
    memory: {
      lastMessageAt: new Date(),
      ...(params.memory ?? {}),
    },
    intentResult: params.intentResult ?? { intent: 'unknown' as any, confidence: 0.5 },
    reservation: params.reservation ?? { status: 'unmatched', confidence: 0 },
    knowledge: params.knowledge ?? { universalPolicy: 'Never fabricate' },
    recentMessages: [],
  } as CommunicationContext;
}

function identity(params: Partial<IdentityResolution> = {}): IdentityResolution {
  return {
    role: 'guest',
    entityType: 'unknown',
    confidence: 0,
    status: 'unresolved',
    ...params,
  };
}

describe('scenario-engine', () => {
  it('classifies invoice/receipt request', () => {
    const context = ctx();
    const id = identity();
    const entityResolution = resolveEntities({ text: 'need invoice please', identity: id, context });
    const { decision } = buildDecisionAndPlan({
      text: 'need invoice please',
      classification: { category: 'fallback' as any, lang: 'en', slots: { isUrgent: false, isAccessRelated: false, mentionsGuest: false, mentionsTime: false, mentionsObject: false } },
      intent: { intent: 'general_question' as any, confidence: 0.7 } as IntentResult,
      identity: id,
      context,
      entityResolution,
    });
    expect(decision.scenario).toBe('invoice_receipt_request');
  });

  it('returns ambiguous entityResolution when reservation match is ambiguous', () => {
    const context = ctx({
      reservation: {
        status: 'ambiguous',
        confidence: 0.6,
        candidates: [{ reservationId: 'res_1', guestName: 'Jane', checkIn: '2026-05-01' }],
      },
    });
    const id = identity({ status: 'unresolved' });
    const er = resolveEntities({ text: 'check-in code?', identity: id, context });
    expect(er.status).toBe('ambiguous');
    expect(er.candidates?.[0]?.id).toBe('res_1');
  });

  it('picks ask_clarifying_question when entity is ambiguous', () => {
    const context = ctx({
      reservation: {
        status: 'ambiguous',
        confidence: 0.6,
        candidates: [{ reservationId: 'res_1' }],
      },
    });
    const id = identity();
    const er = resolveEntities({ text: 'check-in?', identity: id, context });
    const { decision } = buildDecisionAndPlan({
      text: 'check-in?',
      classification: { category: 'booking' as any, lang: 'en', slots: { isUrgent: false, isAccessRelated: false, mentionsGuest: false, mentionsTime: true, mentionsObject: true } },
      intent: { intent: 'check_in_info' as any, confidence: 0.8 } as IntentResult,
      identity: id,
      context,
      entityResolution: er,
    });
    expect(decision.nextAction).toBe('ask_clarifying_question');
  });

  it('escalates payment issue scenario', () => {
    const context = ctx();
    const id = identity();
    const er = resolveEntities({ text: 'payment failed refund', identity: id, context });
    const { decision } = buildDecisionAndPlan({
      text: 'payment failed refund',
      classification: { category: 'guest-message' as any, lang: 'en', slots: { isUrgent: false, isAccessRelated: false, mentionsGuest: false, mentionsTime: false, mentionsObject: false } },
      intent: { intent: 'payment_request' as any, confidence: 0.9 } as IntentResult,
      identity: id,
      context,
      entityResolution: er,
    });
    expect(decision.scenario).toBe('payment_issue');
    expect(decision.nextAction).toBe('escalate');
  });
});

