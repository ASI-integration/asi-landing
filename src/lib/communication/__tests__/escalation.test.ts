import { describe, it, expect } from 'vitest';
import {
  createEscalationEvent,
  deriveEscalationReason,
  shouldEscalate,
} from '../escalation';
import { classify } from '../classifier';
import { EscalationReason, MessageCategory } from '../types';

describe('shouldEscalate', () => {
  it('escalates urgent access issues even when LLM succeeded', () => {
    const r = classify('urgent lock failed');
    expect(shouldEscalate(r, true)).toBe(true);
  });

  it('escalates when LLM failed on a guest message', () => {
    const r = classify('guest says the room is dirty');
    expect(shouldEscalate(r, false)).toBe(true);
  });

  it('escalates when LLM failed on a booking message', () => {
    const r = classify('check-in at 2pm');
    expect(shouldEscalate(r, false)).toBe(true);
  });

  it('does NOT escalate a greeting even when LLM failed', () => {
    const r = classify('hello');
    expect(shouldEscalate(r, false)).toBe(false);
  });

  it('does NOT escalate start command', () => {
    const r = classify('/start');
    expect(shouldEscalate(r, false)).toBe(false);
  });

  it('does NOT escalate a normal issue when LLM succeeded', () => {
    const r = classify('problem with heating');
    expect(shouldEscalate(r, true)).toBe(false);
  });
});

describe('deriveEscalationReason', () => {
  it('returns UrgentIssue for urgent access issue', () => {
    const r = classify('urgent lock failed');
    expect(deriveEscalationReason(r, true)).toBe(EscalationReason.UrgentIssue);
  });

  it('returns LLMUncertain when LLM fails', () => {
    const r = classify('guest says wifi is broken');
    expect(deriveEscalationReason(r, false)).toBe(EscalationReason.LLMUncertain);
  });
});

describe('createEscalationEvent', () => {
  it('constructs a well-formed event', () => {
    const r = classify('urgent lock failed');
    const event = createEscalationEvent({
      reason: EscalationReason.UrgentIssue,
      chat_id: 12345,
      update_id: 99,
      classification: r,
      summary: 'urgent access issue',
    });
    expect(event.reason).toBe(EscalationReason.UrgentIssue);
    expect(event.chat_id).toBe(12345);
    expect(event.update_id).toBe(99);
    expect(event.category).toBe(MessageCategory.Issue);
    expect(event.summary).toBe('urgent access issue');
    expect(event.created_at).toBeTruthy();
  });
});
