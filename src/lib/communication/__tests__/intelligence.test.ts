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
  type KnowledgeClient = NonNullable<Parameters<typeof getGroundedKnowledge>[2]>;

  const canonicalRow = {
    property_id: 'property-a',
    property_policy: 'Verified policy',
    house_rules: 'Verified rules',
    checkin_instructions: 'Use the north entrance.',
    checkout_notes: 'Leave the key in the lockbox.',
    wifi_instructions: null,
    wifi_name: 'Property-A-WiFi',
    wifi_password: 'property-a-password',
    parking_instructions: 'Courtyard parking',
    payment_rules: 'Card only',
    upsells: null,
    emergency_contacts: 'Operator desk',
    active: true,
  };

  function knowledgeClient(result: { data: unknown; error: { message: string } | null }) {
    const state = { selected: '', propertyId: '' };
    const client = {
      from: vi.fn(() => ({
        select: vi.fn((selected: string) => {
          state.selected = selected;
          return {
            eq: vi.fn((_column: string, propertyId: string) => {
              state.propertyId = propertyId;
              return { maybeSingle: vi.fn(async () => result) };
            }),
          };
        }),
      })),
    } as unknown as KnowledgeClient;
    return { client, state };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('maps canonical Wi-Fi, check-in, and checkout fields for the requested property', async () => {
    const { client, state } = knowledgeClient({ data: canonicalRow, error: null });

    const know = await getGroundedKnowledge('property-a', undefined, client);

    expect(state.propertyId).toBe('property-a');
    expect(state.selected).toContain('checkin_instructions');
    expect(state.selected).toContain('checkout_notes');
    expect(state.selected).not.toContain('check_in_instructions');
    expect(state.selected).not.toContain('check_out_instructions');
    expect(know).toMatchObject({
      propertyId: 'property-a',
      loadStatus: 'found',
      checkInInstructions: 'Use the north entrance.',
      checkOutInstructions: 'Leave the key in the lockbox.',
      wifiInstructions: 'Network: Property-A-WiFi, Password: property-a-password',
    });
  });

  it('distinguishes missing knowledge from a database/query failure', async () => {
    const missing = knowledgeClient({ data: null, error: null });
    const failed = knowledgeClient({ data: null, error: { message: 'column lookup failed' } });

    const missingKnowledge = await getGroundedKnowledge('property-a', undefined, missing.client);
    const failedKnowledge = await getGroundedKnowledge('property-a', undefined, failed.client);

    expect(missingKnowledge.loadStatus).toBe('not_found');
    expect(failedKnowledge.loadStatus).toBe('lookup_failed');
    expect(failedKnowledge.propertyPolicy).toMatch(/unavailable/);
    expect(failedKnowledge.checkInInstructions).not.toContain('1234');
    expect(failedKnowledge.wifiInstructions).not.toContain('GuestWifi');
    expect(failedKnowledge.universalPolicy).toContain('Never fabricate');
  });

  it('fails closed when a query returns another property row', async () => {
    const { client } = knowledgeClient({
      data: { ...canonicalRow, property_id: 'property-b', wifi_name: 'Property-B-WiFi' },
      error: null,
    });

    const know = await getGroundedKnowledge('property-a', undefined, client);

    expect(know.propertyId).toBe('property-a');
    expect(know.loadStatus).toBe('lookup_failed');
    expect(know.wifiInstructions).not.toContain('Property-B-WiFi');
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
