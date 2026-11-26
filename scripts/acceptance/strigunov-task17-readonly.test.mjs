import test from 'node:test';
import assert from 'node:assert/strict';
import { physicalAcceptance, commitOutcome } from './strigunov-task17-contract.mjs';

// Synthetic test data demonstrates validation only; it is never physical proof.
function fixture() {
 const scope = { runId: '123', sha: 'a'.repeat(40), accountId: 'account-a', propertyId: 'property-a', eventId: 'event-a' };
 const requirements = {
  G2: ['effectiveAllowlists', 'sevenNoSendFlags', 'humanLogin'],
  G3: ['historicalReconciliation', 'freshScope'],
  G4: ['intakeDeduplication', 'crmCorrelation', 'cleaning', 'linen', 'supplies', 'readiness', 'unknownStateStop'],
  G5: ['humanUi', 'unauthenticatedDenial', 'crossAccountDenial', 'getNoWrites', 'independentNoSend'],
  G6: ['independentReview', 'ownerAcceptance'],
 };
 const gates = Object.fromEntries(Object.entries(requirements).map(([gate, names]) => [gate,
  Object.fromEntries(names.map(name => [name, { ...scope, observed: true, kind: 'physical',
   source: `fixture-only/${gate}/${name}`, actorId: name === 'ownerAcceptance' ? 'owner' : 'reviewer' }]))]));
 return { ...scope, environment: 'staging', synthetic: true, operatorId: 'operator', ownerId: 'owner', reviewerId: 'reviewer', gates };
}

test('complete supplied evidence remains pilot-only and cannot accept a release', () => {
 assert.deepEqual(physicalAcceptance(fixture()), { status: 'EVIDENCE_COMPLETE',
  completedGates: ['G2', 'G3', 'G4', 'G5', 'G6'], pilotOnly: true, releaseAccepted: false });
});

test('missing or blank account, property, event, run or SHA fails closed', () => {
 for (const key of ['accountId', 'propertyId', 'eventId', 'runId', 'sha']) {
  for (const value of [undefined, null, '', ' ', 123]) {
   assert.throws(() => physicalAcceptance({ ...fixture(), [key]: value }), { code: 'PHYSICAL_SCOPE' });
  }
 }
 assert.throws(() => physicalAcceptance(null), { code: 'PHYSICAL_SCOPE' });
});

test('every required observation must be present and physically observed', () => {
 const base = fixture();
 for (const [gate, observations] of Object.entries(base.gates)) {
  const missingGate = fixture();
  delete missingGate.gates[gate];
  assert.throws(() => physicalAcceptance(missingGate));
  for (const name of Object.keys(observations)) {
   for (const replacement of [undefined, {}, { ...observations[name], observed: false },
    { ...observations[name], kind: 'unit-test' }, { ...observations[name], source: ' ' }]) {
    const e = fixture();
    e.gates[gate][name] = replacement;
    assert.throws(() => physicalAcceptance(e), { code: `PHYSICAL_${gate}_${name}` });
   }
  }
 }
});

test('all observations bind to the exact account, property, event, run and SHA', () => {
 for (const [gate, observations] of Object.entries(fixture().gates)) {
  for (const name of Object.keys(observations)) {
   for (const key of ['accountId', 'propertyId', 'eventId', 'runId', 'sha']) {
    for (const value of [undefined, 'different']) {
     const e = fixture();
     e.gates[gate][name][key] = value;
     assert.throws(() => physicalAcceptance(e), { code: `PHYSICAL_${gate}_${name}` });
    }
   }
  }
 }
});

test('reviewer identity is required and independent of operator and owner', () => {
 for (const reviewerId of [undefined, '', ' ', 'operator', 'owner']) {
  assert.throws(() => physicalAcceptance({ ...fixture(), reviewerId }), { code: 'PHYSICAL_REVIEWER' });
 }
 for (const key of ['operatorId', 'ownerId']) {
  assert.throws(() => physicalAcceptance({ ...fixture(), [key]: undefined }), { code: 'PHYSICAL_REVIEWER' });
 }
});

test('independent review and no-send observations require the named reviewer', () => {
 for (const [gate, name] of [['G5', 'independentNoSend'], ['G6', 'independentReview']]) {
  for (const actorId of [undefined, 'operator', 'owner']) {
   const e = fixture();
   e.gates[gate][name].actorId = actorId;
   assert.throws(() => physicalAcceptance(e), { code: 'PHYSICAL_REVIEWER' });
  }
 }
});

test('owner acceptance cannot be replaced by reviewer approval', () => {
 const e = fixture();
 e.gates.G6.ownerAcceptance.actorId = e.reviewerId;
 assert.throws(() => physicalAcceptance(e), { code: 'PHYSICAL_OWNER' });
});

test('production and real-data evidence cannot qualify for pilot validation', () => {
 for (const patch of [{ environment: 'production' }, { environment: undefined }, { synthetic: false }, { synthetic: 'true' }]) {
  assert.throws(() => physicalAcceptance({ ...fixture(), ...patch }), { code: 'PHYSICAL_PILOT_ONLY' });
 }
});

test('validation is deterministic and leaves supplied evidence untouched', () => {
 const e = fixture();
 const before = structuredClone(e);
 assert.deepEqual(physicalAcceptance(e), physicalAcceptance(e));
 assert.deepEqual(e, before);
});

test('existing commit acknowledgement retains HOLD without blind retry', () => {
 assert.deepEqual(commitOutcome('COMMIT'), { status: 'ACK', retry: false });
 for (const ack of [undefined, '', 'ROLLBACK', 'UNKNOWN']) {
  assert.deepEqual(commitOutcome(ack), { status: 'HOLD', retry: false });
 }
});
