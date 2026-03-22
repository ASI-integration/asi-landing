import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchReservation } from '../reservation';
import { getGroundedKnowledge } from '../knowledge';
import { buildCommunicationContext } from '../context';
import { classifyIssuePriority } from '../triage';
import { evaluateActionSafety } from '../action';
import { IntentCategory } from '../types';

describe('ReservationMatcher', () => {
  it('matches exactly by booking reference', async () => {
    const res = await matchReservation({ bookingReference: 'res_111' });
    expect(res.status).toBe('matched');
    expect(res.guestName).toBe('John Doe');
  });

  it('matches exactly by phone', async () => {
    const res = await matchReservation({ phone: '+1234567890' });
    expect(res.status).toBe('matched');
  });

  it('detects ambiguous names', async () => {
    const res = await matchReservation({ guestName: 'Jane Smith' });
    expect(res.status).toBe('ambiguous');
    expect(res.candidates?.length).toBe(2);
  });

  it('returns unmatched securely', async () => {
    const res = await matchReservation({ guestName: 'Nobody' });
    expect(res.status).toBe('unmatched');
  });
});

describe('KnowledgeGrounder', () => {
  it('returns explicit unavailabity if knowledge missing', async () => {
    const know = await getGroundedKnowledge('unknown_prop');
    expect(know.propertyPolicy).toMatch(/unavailable/);
    expect(know.universalPolicy).toContain('Never fabricate');
  });

  it('returns property facts', async () => {
    const know = await getGroundedKnowledge('prop_A');
    expect(know.checkInInstructions).toContain('1234*');
  });
});

describe('IssueTriageClassifier', () => {
  it('classifies lockout as emergency', () => {
    const p = classifyIssuePriority(
      'urgent no entry to the apartment',
      IntentCategory.IssueReport,
      { isUrgent: true, isAccessRelated: true, mentionsGuest: false, mentionsTime: false, mentionsObject: true }
    );
    expect(p).toBe('emergency');
  });

  it('classifies wifi issue as urgent', () => {
    const p = classifyIssuePriority(
      'wifi not working',
      IntentCategory.IssueReport,
      { isUrgent: false, isAccessRelated: false, mentionsGuest: false, mentionsTime: false, mentionsObject: false }
    );
    expect(p).toBe('urgent');
  });
});

describe('ActionPolicyGuard', () => {
  it('escalates emergency', async () => {
    const ctx = await buildCommunicationContext(123, '', { intent: IntentCategory.IssueReport, confidence: 0.9 }, []);
    const safety = evaluateActionSafety(ctx, 'fire in kitchen');
    expect(safety.safe).toBe(false);
    expect(safety.action).toBe('escalate_to_operator');
  });

  it('asks clarifying question on ambiguous intent', async () => {
    const ctx = await buildCommunicationContext(123, '', { intent: IntentCategory.Unknown, confidence: 0.8 }, []);
    const safety = evaluateActionSafety(ctx, '?');
    expect(safety.safe).toBe(true);
    expect(safety.action).toBe('ask_clarifying_question');
  });
});
