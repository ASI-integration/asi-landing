import { describe, expect, it } from 'vitest';
import { computeCheckinReleaseGate, validateGuestIntakeFields } from '../guest-intake-checkin-release';

const completeFields = {
  fullName: 'Тестовый Гость', phone: '+70000000000', guestCount: 2,
  arrivalWindow: '15:00–17:00', identityStatus: 'complete' as const,
  citizenshipStatus: 'указано', consentAcknowledged: true,
};

describe('Guest Telegram Intake & Check-in Release Pack v1', () => {
  it('keeps an empty intake incomplete and exposes missing fields', () => {
    const result = validateGuestIntakeFields({});
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toContain('full_name');
    expect(result.blockerReasons).toContain('guest_required_fields_missing');
  });

  it('keeps a partial submission incomplete', () => {
    const result = validateGuestIntakeFields({ fullName: 'Тестовый Гость' });
    expect(result.dataStatus).toBe('partial');
    expect(result.isComplete).toBe(false);
  });

  it('requires either phone or Telegram reference', () => {
    const result = validateGuestIntakeFields({ ...completeFields, phone: undefined });
    expect(result.missingFields).toContain('contact');
  });

  it('rejects invalid phone and guest count', () => {
    const result = validateGuestIntakeFields({ ...completeFields, phone: 'x', guestCount: 0 });
    expect(result.validationErrors).toHaveLength(2);
    expect(result.isComplete).toBe(false);
  });

  it('accepts complete deterministic intake data', () => {
    const result = validateGuestIntakeFields(completeFields);
    expect(result.isComplete).toBe(true);
    expect(result.missingFields).toEqual([]);
    expect(result.blockerReasons).toEqual([]);
  });

  it('does not accept partial document status', () => {
    const result = validateGuestIntakeFields({ ...completeFields, identityStatus: 'partial' });
    expect(result.missingFields).toContain('identity_status');
  });

  it('blocks release while guest intake is incomplete', () => {
    const gate = computeCheckinReleaseGate({
      validation: validateGuestIntakeFields({ fullName: 'Гость' }),
      intakeStatus: 'partially_completed', legalStatus: 'ready_for_checkin', physicalReady: true,
    });
    expect(gate.canPrepareCheckinReleaseDraft).toBe(false);
    expect(gate.blockerReasons).toContain('guest_intake_incomplete');
  });

  it('blocks release while legal gates are incomplete', () => {
    const gate = computeCheckinReleaseGate({
      validation: validateGuestIntakeFields(completeFields),
      intakeStatus: 'completed', legalStatus: 'incomplete', physicalReady: true,
    });
    expect(gate.blockerReasons).toEqual(['legal_gate_blocked']);
  });

  it('blocks release while physical readiness is incomplete', () => {
    const gate = computeCheckinReleaseGate({
      validation: validateGuestIntakeFields(completeFields),
      intakeStatus: 'completed', legalStatus: 'ready_for_checkin', physicalReady: false,
    });
    expect(gate.blockerReasons).toEqual(['physical_readiness_blocked']);
  });

  it('operator escalation never clears intake blockers', () => {
    const gate = computeCheckinReleaseGate({
      validation: validateGuestIntakeFields(completeFields),
      intakeStatus: 'fallback_required', legalStatus: 'ready_for_checkin', physicalReady: true,
    });
    expect(gate.canPrepareCheckinReleaseDraft).toBe(false);
    expect(gate.blockerReasons).toContain('guest_intake_needs_operator');
  });

  it('allows a release draft only after every gate passes', () => {
    const gate = computeCheckinReleaseGate({
      validation: validateGuestIntakeFields(completeFields),
      intakeStatus: 'completed', legalStatus: 'ready_for_checkin', physicalReady: true,
    });
    expect(gate).toEqual({ canPrepareCheckinReleaseDraft: true, blockerReasons: [] });
  });
});
