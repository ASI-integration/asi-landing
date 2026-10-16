import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
async function main() {
  assert.equal(process.env.CI, 'true'); assert.equal(process.env.STRIGUNOV_SYNTHETIC_ONLY, 'YES');
  assert.equal(process.env.ASI_SYNTHETIC_NO_SEND, 'YES');
  assert.match(process.env.LAB_NETWORK ?? '', /^strigfin-[0-9]+-1$/);
  assert.equal(process.env.SUPABASE_URL, 'http://127.0.0.1:33001');
  const { supabase } = await import('../../src/lib/supabase');
  const id = JSON.parse(readFileSync('finishline-results/reservation.json', 'utf8')).id as string;
  const scope = { accountId: '29300000-0000-4000-8000-000000000002', propertyId: '29300000-0000-4000-8000-000000000003' };
  const results: Array<{ gate: string; id: string; status: string; error?: string }> = [];
  const check = async (gate: string, name: string, fn: () => Promise<void>) => {
    try { await fn(); results.push({ gate, id: name, status: 'PASS' }); }
    catch (e) { results.push({ gate, id: name, status: 'FAIL', error: String(e).slice(0, 250) }); }
  };
  if (process.argv.includes('--inflight')) {
    const { recordAndProcessBookingEvent, durableEventId } = await import('../../src/lib/booking-ops/lifecycle-autopilot-service');
    await recordAndProcessBookingEvent({ id: durableEventId(id, 'g0-inflight', process.argv.at(-1)), bookingId: id, objectId: scope.propertyId, type: 'alert.acknowledged', actorType: 'system', source: 'g0-inflight' }, scope);
    return;
  }
  if (process.argv.includes('--paused')) {
    const { runBookingOpsAutomationForBooking } = await import('../../src/lib/booking-ops/booking-automation-runner');
    const { orchestrateBookingLifecycle } = await import('../../src/lib/booking-ops/lifecycle-orchestrator');
    const { initializeBookingOpsCoreLoop } = await import('../../src/lib/booking-ops/core-loop-initialization');
    const { recordAndProcessBookingEvent, durableEventId } = await import('../../src/lib/booking-ops/lifecycle-autopilot-service');
    for (const [name, call] of [
      ['automation-runner', () => runBookingOpsAutomationForBooking({ bookingId: id, expectedAccountId: scope.accountId, expectedPropertyId: scope.propertyId })],
      ['lifecycle-orchestrator', () => orchestrateBookingLifecycle({ bookingId: id, expectedScope: scope })],
      ['core-loop', () => initializeBookingOpsCoreLoop(id, scope)],
      ['domain-worker', () => recordAndProcessBookingEvent({ id: durableEventId(id, 'paused'), bookingId: id, objectId: scope.propertyId, type: 'guest.contacted', actorType: 'system', source: 'g0-paused' }, scope)],
    ] as const) await check('G0-3', 'durable-takeover-blocks-' + name, async () => { await assert.rejects(call, /booking_automation_manually_paused/); });
    await check('G0-3', 'takeover-does-not-release-mandatory-gates', async () => {
      const state = await supabase.from('booking_ops_autopilot_states').select('state').eq('booking_id', id).single();
      assert.equal(state.error, null); assert.ok(!state.data.state.completed.includes('checkin_released'));
      const stopped = await supabase.from('booking_ops_communication_auto_send_scopes').select('emergency_stop').eq('scope_type', 'global').single();
      assert.equal(stopped.error, null); assert.equal(stopped.data.emergency_stop, true);
    });
  } else {
    await check('G0-1', 'nonproduction-policy-does-not-grant-staff', async () => {
      const { isCrmOperatorEmail, isOpsAdminEmail } = await import('../../src/lib/crm/access');
      const previous = { NODE_ENV: process.env.NODE_ENV, CRM_OPERATOR_EMAILS: process.env.CRM_OPERATOR_EMAILS, OPERATOR_EMAIL: process.env.OPERATOR_EMAIL, OPS_ADMIN_EMAILS: process.env.OPS_ADMIN_EMAILS };
      try {
        Object.assign(process.env, { NODE_ENV: 'development', CRM_OPERATOR_EMAILS: '', OPERATOR_EMAIL: '', OPS_ADMIN_EMAILS: '' });
        assert.equal(isCrmOperatorEmail('owner@example.invalid'), false);
        assert.equal(isCrmOperatorEmail('unverified@asi-global.ru'), false);
        assert.equal(isOpsAdminEmail('owner@example.invalid'), false);
        process.env.CRM_OPERATOR_EMAILS = 'staff@example.invalid';
        assert.equal(isCrmOperatorEmail('staff@example.invalid'), true);
      } finally { for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    });
    await check('G0-4', 'real-boundary-positive-canaries-denied-before-provider', async () => {
      const { EmailAdapter } = await import('../../src/lib/communication/channels/email');
      const { TelegramAdapter } = await import('../../src/lib/communication/channels/telegram');
      const { sendGuestLifecycleVoiceCopy } = await import('../../src/lib/communication/guest-lifecycle-voice');
      const { createPaymentRequest } = await import('../../src/lib/payments/factory');
      const { StripeProvider } = await import('../../src/lib/payments/stripe');
      const { YookassaProvider } = await import('../../src/lib/payments/yookassa');
      const payment = { id: 'g0-canary', amount: 1, currency: 'RUB' };
      process.env.ASI_SYNTHETIC_CANARY = 'YES';
      try {
        for (const call of [
          () => new EmailAdapter().sendMessage('nobody@example.invalid', 'synthetic'),
          () => new TelegramAdapter().sendMessage('0', 'synthetic'),
          () => sendGuestLifecycleVoiceCopy({ channel: 'telegram', targetId: '0', text: 'synthetic', communicationMode: 'voice' }),
          () => createPaymentRequest(payment),
          () => new StripeProvider().createPaymentLink(payment),
          () => new YookassaProvider().createPaymentLink(payment),
          () => new YookassaProvider().createPayment(payment),
        ]) await assert.rejects(call, /external_effects_disabled/);
      } finally { delete process.env.ASI_SYNTHETIC_CANARY; }
      const rows = readFileSync('finishline-results/effect-canary.ndjson', 'utf8').trim().split('\n').map(x => JSON.parse(x));
      assert.equal(new Set(rows.map(x => x.boundary)).size, 7); assert.equal(rows.length, 7);
      writeFileSync('finishline-results/canary.json', JSON.stringify({ source: process.env.REVIEWED_SOURCE_SHA, verifiedBoundaries: 7, calls: rows, externalEffects: 0 }));
    });
    await check('G0-3', 'create-revisioned-incident-fixture', async () => {
      const { reconcileOperatorAlertConditions } = await import('../../src/lib/booking-ops/operator-alerts');
      await reconcileOperatorAlertConditions({ ...scope, bookingId: id, managedSourceDomains: ['g0'], now: new Date().toISOString(), conditions: ['missing_documents', 'deposit_unconfirmed', 'cleaning_delayed', 'provider_uncertain'].map(code => ({ code, incidentFamily: code, sourceDomain: 'g0', sourceGate: code, severity: 'critical' as const, title: 'G0 ' + code, description: 'Synthetic incident', recommendedAction: 'Manual reconciliation; no send', deadlineAt: null })) });
      const alerts = await supabase.from('booking_ops_alerts').select('id,revision').eq('booking_id', id).eq('source_domain', 'g0');
      assert.equal(alerts.error, null); assert.equal(alerts.data?.length, 4); assert.ok(alerts.data?.every(a => Number(a.revision) >= 1));
      writeFileSync('finishline-results/alerts.json', JSON.stringify({ source: process.env.REVIEWED_SOURCE_SHA, ids: alerts.data?.map(a => a.id) }));
    });
  }
  writeFileSync('finishline-results/' + (process.argv.includes('--paused') ? 'paused.json' : 'service.json'), JSON.stringify({ source: process.env.REVIEWED_SOURCE_SHA, results }, null, 2));
  if (results.some(r => r.status === 'FAIL')) process.exitCode = 1;
}
main().catch(e => { writeFileSync('finishline-results/service-error.json', JSON.stringify({ error: String(e).slice(0, 300) })); process.exitCode = 1; });
