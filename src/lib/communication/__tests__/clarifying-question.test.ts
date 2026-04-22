import { describe, it, expect } from 'vitest';
import { pickSingleBestClarifyingQuestion } from '../clarifying-question';
import type { CommunicationDecision } from '../types';

function decision(partial: Partial<CommunicationDecision>): CommunicationDecision {
  return {
    scenario: 'general_unknown',
    confidence: 0.3,
    requiredFacts: [],
    knownFacts: {},
    missingFacts: [],
    entityResolution: { status: 'unresolved', evidence: ['no_strong_signals'] },
    nextAction: 'ask_clarifying_question',
    reason: 'test',
    ...partial,
  };
}

describe('pickSingleBestClarifyingQuestion', () => {
  it('asks to disambiguate reservation when entity is ambiguous', () => {
    const q = pickSingleBestClarifyingQuestion({
      decision: decision({ entityResolution: { status: 'ambiguous', evidence: ['x'], candidates: [{ type: 'reservation', id: 'r1', reason: 'x' }] } }),
      lang: 'en',
    });
    expect(q?.en).toMatch(/Which reservation/i);
  });

  it('asks for property/address when reservation_or_property missing', () => {
    const q = pickSingleBestClarifyingQuestion({
      decision: decision({ missingFacts: ['reservation_or_property'] }),
      lang: 'en',
    });
    expect(q?.en).toMatch(/property\/address|booking reference/i);
  });

  it('asks for dates when dates missing', () => {
    const q = pickSingleBestClarifyingQuestion({
      decision: decision({ missingFacts: ['dates'] }),
      lang: 'en',
    });
    expect(q?.en).toMatch(/What dates/i);
  });
});

