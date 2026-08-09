import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  executeGuestLifecycleEvent,
  guestLifecycleIdempotencyKey,
  normalizeGuestLifecycleEvent,
  planGuestLifecycleCommunication,
} from '../guest-lifecycle';
import {
  createSyntheticGuestLifecycleHarness,
  runSyntheticGuestLifecycleAcceptance,
  syntheticGuestLifecycleEvent,
  syntheticLifecycleContext,
} from '../guest-lifecycle-synthetic';
import {
  assertGuestLifecycleSyntheticManifest,
  createGuestLifecycleSyntheticManifest,
  guestLifecycleSyntheticEvents,
  sameGuestLifecycleSyntheticCounts,
} from '../guest-lifecycle-synthetic-db';

describe('Guest Lifecycle Communications v1', () => {
  it('runs the RU lifecycle happy path without external actions', async () => {
    const report = await runSyntheticGuestLifecycleAcceptance({ language: 'ru' });
    expect(report.ok).toBe(true);
    expect(report.noExternalActions).toBe(true);
    expect(report.textDeliveries).toHaveLength(9);
    expect(report.textDeliveries.every((delivery) => /[А-Яа-яЁё]/.test(delivery.text))).toBe(true);
  });

  it('runs the EN lifecycle happy path', async () => {
    const report = await runSyntheticGuestLifecycleAcceptance({ language: 'en' });
    expect(report.ok).toBe(true);
    expect(report.textDeliveries).toHaveLength(9);
    expect(report.textDeliveries[0]?.text).toContain('reservation');
  });

  it('uses remembered language before event fallback language', () => {
    const context = syntheticLifecycleContext({
      guestMemory: {
        preferredLanguage: 'en', preferredCommunicationMode: 'text', returningGuest: true,
        stayCount: 1, lastStayAt: null, preferences: [], events: [],
      },
    });
    const plan = planGuestLifecycleCommunication({
      event: syntheticGuestLifecycleEvent('arrival.due_24h', { language: 'ru' }),
      context,
    });
    expect(plan.language).toBe('en');
    expect(plan.text).toContain('tomorrow');
  });

  it('routes a text preference to readable text only', async () => {
    const harness = createSyntheticGuestLifecycleHarness();
    await executeGuestLifecycleEvent(syntheticGuestLifecycleEvent('reservation.created'), harness.port);
    expect(harness.state.textDeliveries).toHaveLength(1);
    expect(harness.state.voiceAttempts).toHaveLength(0);
  });

  it('routes a voice preference while retaining the text representation', async () => {
    const context = syntheticLifecycleContext({
      guestMemory: {
        preferredLanguage: 'ru', preferredCommunicationMode: 'voice', returningGuest: false,
        stayCount: 0, lastStayAt: null, preferences: [], events: [],
      },
    });
    const harness = createSyntheticGuestLifecycleHarness({ context });
    await executeGuestLifecycleEvent(syntheticGuestLifecycleEvent('arrival.due_24h'), harness.port);
    expect(harness.state.textDeliveries).toHaveLength(1);
    expect(harness.state.voiceAttempts).toEqual([expect.objectContaining({ sent: true })]);
  });

  it('keeps the text delivery successful when TTS/provider voice fails', async () => {
    const context = syntheticLifecycleContext({
      guestMemory: {
        preferredLanguage: 'ru', preferredCommunicationMode: 'voice', returningGuest: false,
        stayCount: 0, lastStayAt: null, preferences: [], events: [],
      },
    });
    const harness = createSyntheticGuestLifecycleHarness({ context });
    harness.setVoiceFailure(true);
    const result = await executeGuestLifecycleEvent(syntheticGuestLifecycleEvent('arrival.due_24h'), harness.port);
    expect(result.ok).toBe(true);
    expect(harness.state.textDeliveries).toHaveLength(1);
    expect(harness.state.voiceAttempts[0]?.sent).toBe(false);
  });

  it('maps duplicate canonical events to one deterministic outbound delivery', async () => {
    const harness = createSyntheticGuestLifecycleHarness();
    const event = syntheticGuestLifecycleEvent('reservation.confirmed');
    const first = await executeGuestLifecycleEvent(event, harness.port);
    const second = await executeGuestLifecycleEvent(event, harness.port);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(harness.state.textDeliveries).toHaveLength(1);
    expect(guestLifecycleIdempotencyKey(event)).toBe(guestLifecycleIdempotencyKey({ ...event }));
  });

  it('does not duplicate a successfully sent message on retry', async () => {
    const harness = createSyntheticGuestLifecycleHarness();
    const event = syntheticGuestLifecycleEvent('checkout.due_24h');
    await executeGuestLifecycleEvent(event, harness.port);
    await executeGuestLifecycleEvent(event, harness.port);
    await executeGuestLifecycleEvent(event, harness.port);
    expect(harness.state.textDeliveries).toHaveLength(1);
  });

  it('survives application restart/replay with shared durable state', async () => {
    const firstProcess = createSyntheticGuestLifecycleHarness();
    const event = syntheticGuestLifecycleEvent('guest.checked_out');
    await executeGuestLifecycleEvent(event, firstProcess.port);
    const restartedProcess = createSyntheticGuestLifecycleHarness({ state: firstProcess.state });
    const replay = await executeGuestLifecycleEvent(event, restartedProcess.port);
    expect(replay.duplicate).toBe(true);
    expect(restartedProcess.state.textDeliveries).toHaveLength(1);
  });

  it('blocks an unknown guest without proactive delivery', async () => {
    const harness = createSyntheticGuestLifecycleHarness();
    harness.setResolution({ ok: false, reason: 'unknown_guest' });
    const result = await executeGuestLifecycleEvent(syntheticGuestLifecycleEvent('arrival.due_24h'), harness.port);
    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('blocked');
    expect(harness.state.textDeliveries).toHaveLength(0);
  });

  it('blocks a wrong reservation/guest binding', async () => {
    const harness = createSyntheticGuestLifecycleHarness();
    harness.setResolution({ ok: false, reason: 'reservation_guest_mismatch' });
    const result = await executeGuestLifecycleEvent(syntheticGuestLifecycleEvent('checkin.ready'), harness.port);
    expect(result.record).toMatchObject({ status: 'blocked', failureReason: 'reservation_guest_mismatch' });
    expect(harness.state.textDeliveries).toHaveLength(0);
  });

  it('suppresses future arrival and check-in communication after cancellation', async () => {
    const context = syntheticLifecycleContext({ reservationCancelled: true });
    const harness = createSyntheticGuestLifecycleHarness({ context });
    for (const eventType of ['arrival.due_24h', 'arrival.due_3h', 'checkin.ready'] as const) {
      const result = await executeGuestLifecycleEvent(syntheticGuestLifecycleEvent(eventType), harness.port);
      expect(result.record.status).toBe('skipped');
    }
    expect(harness.state.textDeliveries).toHaveLength(0);
  });

  it('never auto-approves a late-checkout request', async () => {
    const harness = createSyntheticGuestLifecycleHarness();
    const result = await executeGuestLifecycleEvent(syntheticGuestLifecycleEvent('late_checkout.requested'), harness.port);
    expect(result.record.status).toBe('operator_required');
    expect(harness.state.operatorRequests[0]?.reason).toBe('late_checkout_requires_operator_approval');
    expect(harness.state.textDeliveries).toHaveLength(0);
  });

  it('routes unconfirmed late-checkout outcomes to an operator', async () => {
    const harness = createSyntheticGuestLifecycleHarness();
    const result = await executeGuestLifecycleEvent(syntheticGuestLifecycleEvent('late_checkout.approved'), harness.port);
    expect(result.record.status).toBe('operator_required');
    expect(harness.state.memoryEvents).toHaveLength(0);
  });

  it('routes an existing handoff state through the operator system', async () => {
    const harness = createSyntheticGuestLifecycleHarness({ context: syntheticLifecycleContext({ operatorHandoffActive: true }) });
    const result = await executeGuestLifecycleEvent(syntheticGuestLifecycleEvent('stay.checkin_followup'), harness.port);
    expect(result.record.status).toBe('operator_required');
    expect(harness.state.operatorRequests[0]?.reason).toBe('existing_operator_handoff_active');
  });

  it('makes an urgent incident override normal lifecycle delivery', async () => {
    const harness = createSyntheticGuestLifecycleHarness();
    const result = await executeGuestLifecycleEvent(syntheticGuestLifecycleEvent('incident.reported'), harness.port);
    expect(result.record.status).toBe('operator_required');
    expect(harness.state.operatorRequests[0]).toMatchObject({ urgent: true, reason: 'urgent_incident_requires_operator' });
    expect(harness.state.textDeliveries).toHaveLength(0);
  });

  it('records only the allowlisted completed-stay memory event', async () => {
    const harness = createSyntheticGuestLifecycleHarness();
    await executeGuestLifecycleEvent(syntheticGuestLifecycleEvent('stay.completed'), harness.port);
    expect(harness.state.memoryEvents).toEqual([
      expect.objectContaining({ type: 'completed_stay', summary: 'Completed stay.' }),
    ]);
  });

  it('does not put transcripts, voice files, access secrets, documents, or payments in the canonical event', () => {
    const normalized = normalizeGuestLifecycleEvent(syntheticGuestLifecycleEvent('incident.reported', {
      facts: { incidentSummary: 'bounded operational summary' },
    }));
    expect(Object.keys(normalized)).not.toEqual(expect.arrayContaining([
      'transcript', 'voiceFile', 'accessCode', 'document', 'payment',
    ]));
  });

  it('holds future events until their canonical schedule is due', async () => {
    const harness = createSyntheticGuestLifecycleHarness();
    const event = syntheticGuestLifecycleEvent('arrival.due_3h', { scheduledFor: '2026-08-10T12:00:00.000Z' });
    const scheduled = await executeGuestLifecycleEvent(event, harness.port, { now: new Date('2026-08-09T12:00:00.000Z') });
    expect(scheduled.record.status).toBe('scheduled');
    expect(harness.state.textDeliveries).toHaveLength(0);
    const due = await executeGuestLifecycleEvent(event, harness.port, { now: new Date('2026-08-10T12:00:01.000Z') });
    expect(due.record.status).toBe('sent');
    expect(harness.state.textDeliveries).toHaveLength(1);
  });

  it('does not duplicate when a provider failure is retried after one successful send record', async () => {
    const harness = createSyntheticGuestLifecycleHarness();
    harness.setTextFailure(true);
    const event = syntheticGuestLifecycleEvent('reservation.created');
    const failed = await executeGuestLifecycleEvent(event, harness.port);
    expect(failed.record.status).toBe('failed');
    harness.setTextFailure(false);
    const retried = await executeGuestLifecycleEvent(event, harness.port);
    expect(retried.record.status).toBe('sent');
    const replay = await executeGuestLifecycleEvent(event, harness.port);
    expect(replay.duplicate).toBe(true);
    expect(harness.state.textDeliveries).toHaveLength(1);
  });

  it('builds an exact isolated reservation, guest, property and event manifest', () => {
    const manifest = createGuestLifecycleSyntheticManifest({
      token: '11111111-1111-4111-8111-111111111111',
      bookingOpsRecordId: '22222222-2222-4222-8222-222222222222',
      autoSendScopeId: '33333333-3333-4333-8333-333333333333',
      autoSendPolicyIds: [
        '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555',
        '66666666-6666-4666-8666-666666666666',
      ],
    });
    expect(manifest).toMatchObject({
      runId: 'glc-synthetic-11111111-1111-4111-8111-111111111111',
      reservationId: '22222222-2222-4222-8222-222222222222',
      bookingOpsRecordId: '22222222-2222-4222-8222-222222222222',
      propertyId: 'glc-synthetic-property-11111111-1111-4111-8111-111111111111',
      guestId: 'glc-synthetic-guest-11111111-1111-4111-8111-111111111111',
      source: 'synthetic_acceptance',
    });
    const events = guestLifecycleSyntheticEvents(manifest, new Date('2030-01-01T12:00:00.000Z'));
    expect(events).toHaveLength(9);
    expect(new Set(events.map((event) => event.sourceEventId)).size).toBe(9);
    expect(events.every((event) => event.reservationId === manifest.reservationId)).toBe(true);
  });

  it('refuses a synthetic manifest whose ownership identity was altered', () => {
    const manifest = createGuestLifecycleSyntheticManifest();
    expect(() => assertGuestLifecycleSyntheticManifest({
      ...manifest,
      propertyId: 'real-property',
    })).toThrow('synthetic_property_id_mismatch');
  });

  it('detects row growth during same-process or restarted replay', () => {
    const baseline = { lifecycleEvents: 9, intents: 9, deliveries: 9, attempts: 18, memoryEvents: 1 };
    expect(sameGuestLifecycleSyntheticCounts(baseline, { ...baseline })).toBe(true);
    expect(sameGuestLifecycleSyntheticCounts(baseline, { ...baseline, deliveries: 10 })).toBe(false);
  });

  it('keeps cleanup manifest-bound and requires zero residue', () => {
    const migration = readFileSync(join(
      process.cwd(),
      'supabase/migrations/20260809160000_guest_lifecycle_communications_v1.sql',
    ), 'utf8');
    expect(migration).toContain('synthetic_manifest_identity_mismatch');
    expect(migration).toContain('synthetic_booking_ownership_mismatch');
    expect(migration).toContain('synthetic_contact_ownership_mismatch');
    expect(migration).toContain('synthetic_memory_ownership_mismatch');
    expect(migration).toContain("source_event_id LIKE p_run_id || ':%'");
    expect(migration).toContain("'zeroResidue', v_residue_count = 0");
  });
});
