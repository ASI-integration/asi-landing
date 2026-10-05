import { describe, expect, it } from 'vitest';
import { evaluateCommunicationFacts, resolveCommunicationFacts, type CommunicationFact, type CommunicationFactsResult } from '../../communication/knowledge-provenance';
import { ProcessOutcome } from '../../communication/types';
import { validateSpatialEvidence } from '../../location/spatial-validation';
import type { SpatialEvidence, SpatialLocation, SpatialRequest } from '../../location/spatial-validation-types';
import { computeLaunchReadiness, computeOperationalReadiness, initializeModules } from '../../ops-v17/core';
import type { OnboardingData } from '../../ops-v17/types';
import type { CheckinExecutionSnapshot } from '../../booking-ops/checkin-execution-autopilot';
import type { InStayCheckoutSnapshot, GuestStayIssueRow } from '../../booking-ops/instay-checkout-autopilot';
import type { GuestLegalReadiness } from '../../booking-ops/guest-legal-deposit-mvd-execution';
import { adaptCommunicationDecision } from '../communication-decision';
import { adaptResidentialLocationDecision } from '../location-decision';
import { adaptResidentialOpsDecision, adaptResidentialIncidentDecision, type ResidentialOpsOutput } from '../ops-decision';
import { isPlatformDecision, type PlatformDecision } from '../decision';
import type { IdentifiedScope, ScopedSnapshot } from '../snapshot';

const now = Date.parse('2026-10-02T15:00:00Z'), at = new Date(now).toISOString();
const identity: IdentifiedScope = { kind: 'identified', accountId: 'A', propertyId: 'P', bookingId: 'B' };
const scope = { accountId: 'A', propertyId: 'P', bookingId: 'B' };
const wrap = <T,>(value: T): ScopedSnapshot<T> => ({ available: true, identity: { ...identity }, observedAt: at, value });
const fact = (patch: Partial<CommunicationFact> = {}): CommunicationFact => ({
  key: 'address', value: 'Public address', scope, origin: 'canonical', source: 'owner', reference: 'fact1',
  observedAt: at, verified: true, sensitivity: 'normal', ...patch,
});
function facts(values: CommunicationFact[]): CommunicationFactsResult {
  return { ...evaluateCommunicationFacts({ scope, requestedFacts: ['address'], facts: values, now }), scope };
}
function safe(d: PlatformDecision) {
  expect(isPlatformDecision(d)).toBe(true);
  expect(d.identity).toEqual(identity);
  expect(d.permission.automaticActionAllowed).toBe(false);
  expect(d.permission.forbiddenActions).toContain('send_guest_automatically');
  expect(d.permission.executionAuthority).toBe('domain_revalidation_required');
  expect(JSON.stringify(d)).not.toContain('DO_NOT_LEAK');
}
describe('Communication canonical adapter', () => {
  it('maps the real awaited Wave 2 resolver into a draft-only decision', async () => {
    const result = await resolveCommunicationFacts({ scope, requestedFacts: ['address'] },
      { authorize: async () => true, load: async () => [fact()], now: () => now });
    const d = adaptCommunicationDecision({ identity, result, now });
    safe(d); expect(d.status).toBe('allowed'); expect(d.permission.allowedActions).toEqual(['prepare_operator_draft']);
    expect(JSON.stringify(d)).not.toContain('Public address');
  });
  it.each([
    ['missing', []],
    ['stale', [fact({ observedAt: '2020-01-01T00:00:00Z' })]],
    ['conflicting', [fact(), fact({ value: 'Other address' })]],
    ['sensitive', [fact({ value: 'passport DO_NOT_LEAK' })]],
    ['untrusted', [fact({ origin: 'synthetic' })]],
  ] as const)('preserves %s review', (reason, values) => {
    const d = adaptCommunicationDecision({ identity, result: facts([...values]), now });
    safe(d); expect(d.status).toBe('review_required'); expect(d.audit.reasons).toContain(reason);
    expect(d.permission.allowedActions).toEqual(['request_operator_review']);
  });
  it('does not turn a formerly valid result into fresh evidence', () => {
    const d = adaptCommunicationDecision({ identity, result: facts([fact()]), now: now + 31 * 86_400_000 });
    expect(d.audit.reasons).toContain('stale');
  });
  it('unidentified conversations allow only clarification and contain no tenant facts', () => {
    const d = adaptCommunicationDecision({ identity: { kind: 'unidentified', sessionId: 'session1' }, result: facts([fact()]), now });
    expect(d.permission.allowedActions).toEqual(['clarify_identity']);
    expect(d.evidence).toEqual([]); expect(d.identity).not.toHaveProperty('accountId');
  });
  it.each(['missing_scope', 'foreign_scope', 'foreign_fact', 'empty', 'false_ready'] as const)('fails closed on %s', attack => {
    const r = facts([fact()]);
    if (attack === 'missing_scope') delete r.scope;
    if (attack === 'foreign_scope') r.scope = { ...scope, accountId: 'OTHER' };
    if (attack === 'foreign_fact') r.decisions[0].fact!.scope = { ...scope, propertyId: 'OTHER' };
    if (attack === 'empty') r.decisions = [];
    if (attack === 'false_ready') r.ready = false;
    const d = adaptCommunicationDecision({ identity, result: r, now }); safe(d); expect(d.status).not.toBe('allowed');
  });
  it.each(Object.values(ProcessOutcome))('maps process outcome %s without treating it as evidence', outcome => {
    const d = adaptCommunicationDecision({ identity, result: facts([fact()]), process: { outcome }, now });
    safe(d);
    expect(d.status).toBe(outcome === 'replied' ? 'allowed' : outcome === 'error' ? 'unavailable' : 'review_required');
  });
});

function checkin(): Extract<ResidentialOpsOutput, { kind: 'checkin' }> {
  return { kind: 'checkin', checkin: {
    bookingId: 'B', status: 'access_ready', execution: null, accessStatus: 'ready', lifecycleReady: true,
    lifecycle: null, blockers: [], communications: [], updatedAt: at,
    instructionsStatus: 'prepared', arrivalStatus: 'confirmed', nextAction: null,
    preCheckin: { bookingId: 'B', status: 'ready_for_checkin', hardBlockers: [], warnings: [], requiredActions: [],
      lastRecomputedAt: at, readinessScore: 100, timeline: [], topBlocker: null, lifecycleScore: 100, metadata: {} },
  } satisfies CheckinExecutionSnapshot,
  legalGuard: { block: false, reason: null, readiness: {
    id: 'legal-1', bookingId: 'B', propertySetupId: null, propertyId: 'P', status: 'ready_for_checkin',
    documentsStatus: 'verified', contractStatus: 'signed_manual', depositStatus: 'paid_manual',
    mvdStatus: 'accepted_manual', availabilityStatus: 'no_conflict', blockers: [], warnings: [],
    safeSummary: null, nextAction: null, lastCheckedAt: at, metadata: {}, createdAt: at, updatedAt: at,
  } satisfies GuestLegalReadiness } };
}
function checkout(): InStayCheckoutSnapshot {
  return { bookingId: 'B', status: 'ready_to_close', execution: null, lifecycle: null,
    checkoutInstructionsStatus: 'sent', checkoutConfirmationStatus: 'confirmed', inspectionStatus: 'done',
    depositReturnStatus: 'returned', closureStatus: 'ready_to_close', openIssuesCount: 0, openIssues: [],
    blockers: [], communications: [], nextAction: null, updatedAt: at };
}
describe('Residential operations adapters', () => {
  it('keeps ready distinct from unavailable', () => {
    const d = adaptResidentialOpsDecision(identity, 'checkin', wrap(checkin()), now); safe(d);
    expect(d.status).toBe('allowed'); expect(d.permission.allowedActions).toContain('release_access');
    expect(adaptResidentialOpsDecision(identity, 'checkin', { available: false, reason: 'unavailable' }, now).status).toBe('unavailable');
  });
  it.each(['account', 'property', 'booking', 'stale', 'legal', 'access', 'cleaning', 'not_ready'] as const)('blocks check-in: %s', attack => {
    const v = checkin(), envelope = { available: true as const, identity: { ...identity }, observedAt: at, value: v };
    if (attack === 'account') envelope.identity = { ...identity, accountId: 'OTHER' };
    if (attack === 'property') v.legalGuard.readiness.propertyId = 'OTHER';
    if (attack === 'booking') v.checkin.bookingId = 'OTHER';
    if (attack === 'stale') v.checkin.updatedAt = '2020-01-01T00:00:00Z';
    if (attack === 'legal') v.legalGuard.block = true;
    if (attack === 'access') v.checkin.accessStatus = 'unknown';
    if (attack === 'cleaning') v.checkin.blockers = [{ key: 'physical:cleaning_not_verified', title: 'DO_NOT_LEAK', reason: 'DO_NOT_LEAK', fallbackEligible: true }];
    if (attack === 'not_ready') v.checkin.lifecycleReady = false;
    const d = adaptResidentialOpsDecision(identity, 'checkin', envelope, now); safe(d);
    expect(d.status).not.toBe('allowed'); expect(d.permission.forbiddenActions).toContain('release_access');
    if (attack === 'cleaning') expect(d.audit.reasons).toContain('cleaning_incomplete');
  });
  it('maps pre-check-in warnings/manual controls without granting access', () => {
    const v = checkin().checkin.preCheckin; v.warnings = [{ key: 'warning', reason: 'DO_NOT_LEAK' } as typeof v.warnings[number]];
    const d = adaptResidentialOpsDecision(identity, 'pre_checkin', wrap({ kind: 'pre_checkin', readiness: v }), now);
    safe(d); expect(d.status).toBe('review_required'); expect(d.permission.forbiddenActions).toContain('release_access');
  });
  it.each(['ready', 'returned', 'waived', 'held', 'partially_held'] as const)('deposit %s retains actual-return semantics', state => {
    const r = checkout(); r.depositReturnStatus = state;
    const d = adaptResidentialOpsDecision(identity, 'deposit', wrap({ kind: 'deposit', checkout: r }), now); safe(d);
    expect(d.status).toBe(['returned', 'waived'].includes(state) ? 'allowed' : 'blocked');
    expect(d.permission.forbiddenActions).toContain('close_booking');
  });
  it('requires the real close guard even for a ready display status', () => {
    const v = { kind: 'closeout', checkout: checkout() } as ResidentialOpsOutput;
    expect(adaptResidentialOpsDecision(identity, 'closeout', wrap(v), now).status).toBe('unavailable');
    const d = adaptResidentialOpsDecision(identity, 'closeout', wrap({ checkout: checkout(), kind: 'closeout',
      prerequisites: [{ key: 'deposit_return_incomplete', category: 'deposit', message: 'DO_NOT_LEAK' }] }), now);
    safe(d); expect(d.permission.forbiddenActions).toContain('close_booking');
  });
  it('allows canonical closeout and preserves unresolved incident blockers', () => {
    const r = checkout();
    const allowed = adaptResidentialOpsDecision(identity, 'closeout', wrap({ kind: 'closeout', checkout: r, prerequisites: [] }), now);
    safe(allowed); expect(allowed.permission.allowedActions).toContain('close_booking');
    r.openIssues = [{ bookingId: 'B', updatedAt: at } as GuestStayIssueRow]; r.openIssuesCount = 1;
    const blocked = adaptResidentialOpsDecision(identity, 'closeout', wrap({ kind: 'closeout', checkout: r, prerequisites: [] }), now);
    safe(blocked); expect(blocked.blockers).toContain('open_incident');
  });
  it.each(['in_stay', 'checkout'] as const)('covers %s workflow output', kind => {
    const r = checkout(); r.status = 'checkout_pending'; r.closureStatus = 'open'; r.checkoutConfirmationStatus = 'requested';
    const d = adaptResidentialOpsDecision(identity, kind, wrap({ kind, checkout: r }), now);
    safe(d); expect(d.requiresHumanReview).toBe(true);
  });
  it('maps actual Ops v17 launch and operational outputs including manual controls', () => {
    const data: OnboardingData = {
      business: { name: 'Pilot' }, owner: { name: 'Owner', phone: '+7000' },
      properties: [{ key: 'P', name: 'Home', address: 'Public' }], units: [{ key: 'U', propertyKey: 'P', name: '1' }],
      operations: { checkInTime: '15:00', checkOutTime: '12:00', cleaningRule: 'after checkout' },
      channelManager: { provider: 'manual_import', snapshotReady: true, status: 'synchronized' },
      reservations: { choice: 'skip', completed: true, criticalConflicts: 0, mappingsComplete: true, ledgerInitialized: true, directIntakeReady: true },
      communications: { guestChannel: 'telegram', workerChannel: 'phone', pilotMode: 'operator_assisted' },
      legalPayments: { legalMode: 'review', depositMode: 'review', mvdMode: 'review' },
      staff: [{ key: 'op', name: 'Operator', role: 'operator', contact: '+7000', propertyKeys: ['P'] }],
      verification: [{ key: 'pilot_readiness', propertyKey: 'P', status: 'passed' }],
    };
    const launch = computeLaunchReadiness(data, initializeModules('onboarding', data));
    const operational = computeOperationalReadiness(data, launch, { ownedPropertyCount: 1, verifiedPropertyCount: 1,
      operatorReady: true, readinessDetails: [], automaticSendingReady: false });
    expect(operational.ready).toBe(true);
    const d = adaptResidentialOpsDecision(identity, 'pilot', wrap({ kind: 'pilot', launch, operational }), now);
    safe(d); expect(d.status).toBe('review_required'); expect(d.manualControls).toContain('manual_control');
  });
});
function spatial() {
  const source = { provider: 'survey', observedAt: at, origin: 'external' as const, delivery: 'live' as const, reference: 'DO_NOT_LEAK' };
  const coordinates = { lat: 59.92, lon: 30.35 };
  const request: SpatialRequest = { scope: { kind: 'account', accountId: 'A', locationId: 'P' }, mode: 'residential', purpose: 'site_assessment', radiusMeters: 1000 };
  const location: SpatialLocation = { scope: request.scope, mode: 'residential', objectKind: 'property', address: 'DO_NOT_LEAK',
    city: 'Saint Petersburg', country: 'RU', coordinates, addressCoordinates: coordinates, source };
  const batch: SpatialEvidence = { scope: request.scope, mode: 'residential', center: coordinates, radiusMeters: 1000,
    source, status: 'available', coverage: ['poi'], entities: [{ id: 'osm1', kind: 'poi', category: 'park', name: 'DO_NOT_LEAK', coordinates, source }] };
  return { request, location, batch };
}
describe('Residential Wave 1 output adapter', () => {
  it('keeps residential spatial envelopes fresh for the Wave 1 24h evidence window', () => {
    const f = spatial();
    const validation = validateSpatialEvidence(f.request, f.location, [f.batch], new Date(now));
    const snapshot: ScopedSnapshot<typeof validation> = {
      available: true,
      identity: { ...identity },
      observedAt: at,
      value: validation,
    };
    const fiveMinutesLater = adaptResidentialLocationDecision(identity, snapshot, now + 5 * 60_000);
    safe(fiveMinutesLater);
    expect(fiveMinutesLater.status).toBe('allowed');

    const expired = adaptResidentialLocationDecision(identity, snapshot, now + 25 * 60 * 60_000);
    safe(expired);
    expect(expired.status).toBe('unavailable');
    expect(expired.audit.reasons).toContain('stale');
  });

  it.each(['valid', 'provider', 'manual', 'foreign', 'stale', 'commercial', 'international'] as const)('maps %s canonical spatial result', scenario => {
    const f = spatial();
    if (scenario === 'provider') f.batch.status = 'unavailable';
    if (scenario === 'manual') f.batch.source.origin = 'manual';
    if (scenario === 'stale') f.batch.source.observedAt = '2020-01-01T00:00:00Z';
    if (scenario === 'international') f.location.country = 'FR';
    const r = validateSpatialEvidence(f.request, f.location, [f.batch], new Date(now));
    if (scenario === 'foreign') r.scope = { kind: 'account', accountId: 'OTHER', locationId: 'P' };
    if (scenario === 'commercial') r.mode = 'commercial';
    const d = adaptResidentialLocationDecision(identity, wrap(r), now); safe(d);
    expect(d.status === 'allowed').toBe(scenario === 'valid');
    if (scenario === 'provider') expect(d.status).toBe('unavailable');
    if (scenario === 'manual') expect(d.manualControls).toContain('operator_verified_spatial_evidence');
    if (scenario === 'valid') expect(r.blockers).not.toContain('commercial_competitor_coverage');
  });
});
describe('Residential incidents', () => {
  it.each(['cleaning_incomplete', 'access_issue', 'maintenance_issue', 'guest_complaint', 'late_checkout', 'lost_item', 'noise_complaint', 'deposit_dispute'])('%s is review-only', issueType => {
    const issue = { id: '11111111-1111-4111-8111-111111111111', bookingId: 'B', issueType, status: 'open', updatedAt: at, description: 'DO_NOT_LEAK', metadata: { password: 'DO_NOT_LEAK' } } as unknown as GuestStayIssueRow;
    const d = adaptResidentialIncidentDecision(identity, wrap(issue), now); safe(d);
    expect(d.status).toBe('review_required'); expect(d.audit.reasons).toContain(issueType);
    expect(d.evidence[0].recordId).toBe(issue.id);
    for (const action of ['release_access', 'close_booking', 'resolve_incident', 'approve_late_checkout', 'discard_lost_item', 'charge_deposit']) {
      expect(d.permission.forbiddenActions).toContain(action);
    }
  });
  it('rejects stale or foreign incident evidence', () => {
    const issue = { id: '11111111-1111-4111-8111-111111111111', bookingId: 'OTHER', issueType: 'lost_item', status: 'open', updatedAt: at } as GuestStayIssueRow;
    expect(adaptResidentialIncidentDecision(identity, wrap(issue), now).status).toBe('unavailable');
    issue.bookingId = 'B'; issue.updatedAt = '2020-01-01T00:00:00Z';
    expect(adaptResidentialIncidentDecision(identity, wrap(issue), now).audit.reasons).toContain('stale');
  });
});

describe('Residential stage-aware action permissions', () => {
  const obsoleteCheckin = ['prepare_operator_draft', 'release_instructions', 'release_access'] as const;
  const assertForbidden = (d: PlatformDecision, actions: readonly string[]) => {
    safe(d);
    for (const action of actions) expect(d.permission.forbiddenActions).toContain(action);
  };
  it.each(['not_prepared', 'failed', 'sent', 'prepared', 'queued'] as const)(
    'access ready with instructions %s never releases an absent or completed draft', instructionsStatus => {
      const v = checkin(); v.checkin.instructionsStatus = instructionsStatus;
      const before = JSON.stringify(v);
      const d = adaptResidentialOpsDecision(identity, 'checkin', wrap(v), now); safe(d);
      expect(d.permission.allowedActions.includes('release_instructions')).toBe(
        instructionsStatus === 'prepared' || instructionsStatus === 'queued');
      expect(d.permission.allowedActions.includes('release_access')).toBe(
        ['prepared', 'queued', 'sent'].includes(instructionsStatus));
      if (instructionsStatus === 'not_prepared') {
        expect(d.status).toBe('review_required');
        expect(d.permission.allowedActions).toEqual(['prepare_operator_draft', 'request_operator_review']);
      }
      if (instructionsStatus === 'failed') expect(d.status).toBe('blocked');
      expect(JSON.stringify(v)).toBe(before);
    });
  it.each(['checked_in', 'pre_checked_in', 'pre_closed', 'execution_checked_in'] as const)(
    '%s suppresses every obsolete check-in action', stage => {
      const v = checkin();
      if (stage === 'checked_in') v.checkin.status = 'checked_in';
      if (stage === 'pre_checked_in') v.checkin.preCheckin.status = 'checked_in';
      if (stage === 'pre_closed') v.checkin.preCheckin.status = 'closed';
      if (stage === 'execution_checked_in') v.checkin.execution = {
        bookingId: 'B', status: 'checked_in',
      } as NonNullable<CheckinExecutionSnapshot['execution']>;
      const d = adaptResidentialOpsDecision(identity, 'checkin', wrap(v), now);
      assertForbidden(d, obsoleteCheckin);
      expect(d.permission.allowedActions).toEqual([]);
      expect(d.audit.reasons).toContain('stage_complete');
    });
  it.each(['checked_in', 'closed'] as const)('pre-check-in %s is a no-op', status => {
    const readiness = checkin().checkin.preCheckin; readiness.status = status;
    const d = adaptResidentialOpsDecision(identity, 'pre_checkin', wrap({ kind: 'pre_checkin', readiness }), now);
    assertForbidden(d, obsoleteCheckin); expect(d.permission.allowedActions).toEqual([]);
  });
  it.each(['checked_in', 'pre_checked_in'] as const)('%s plus access issue requires safe review', stage => {
    const v = checkin(); v.checkin.accessStatus = 'issue';
    if (stage === 'checked_in') v.checkin.status = 'checked_in';
    else v.checkin.preCheckin.status = 'checked_in';
    const d = adaptResidentialOpsDecision(identity, 'checkin', wrap(v), now);
    assertForbidden(d, obsoleteCheckin); expect(d.status).toBe('blocked');
    expect(d.blockers).toContain('access_issue');
  });
  it.each(['instructions_sent', 'instructions_queued'] as const)(
    '%s contradicting the instruction state cannot release anything', status => {
      const v = checkin(); v.checkin.status = status; v.checkin.instructionsStatus = 'not_prepared';
      const d = adaptResidentialOpsDecision(identity, 'checkin', wrap(v), now);
      assertForbidden(d, ['release_instructions', 'release_access']);
      expect(d.status).not.toBe('allowed');
    });
  it('rejects an unknown instruction state without inferring preparation from access', () => {
    const v = checkin(); v.checkin.instructionsStatus = 'DO_NOT_LEAK' as CheckinExecutionSnapshot['instructionsStatus'];
    const d = adaptResidentialOpsDecision(identity, 'checkin', wrap(v), now);
    assertForbidden(d, ['release_instructions', 'release_access']); expect(d.status).toBe('unavailable');
  });
  it.each(['checked_out', 'inspection_pending', 'inspection_done', 'deposit_return_ready', 'ready_to_close'] as const)(
    'checkout at %s cannot re-confirm or prepare obsolete guest drafts', status => {
      const r = checkout(); r.status = status;
      const d = adaptResidentialOpsDecision(identity, 'checkout', wrap({ kind: 'checkout', checkout: r }), now);
      assertForbidden(d, ['confirm_checkout', 'prepare_operator_draft']);
      expect(d.permission.allowedActions).toEqual([]);
    });
  it('pending checkout remains operator review; confirmation is not inferred', () => {
    const r = checkout(); r.status = 'checkout_pending'; r.closureStatus = 'open';
    r.checkoutConfirmationStatus = 'requested';
    const d = adaptResidentialOpsDecision(identity, 'checkout', wrap({ kind: 'checkout', checkout: r }), now);
    safe(d); expect(d.status).toBe('review_required');
    expect(d.permission.forbiddenActions).toContain('confirm_checkout');
    expect(d.permission.allowedActions).toContain('request_operator_review');
  });
  it.each(['returned', 'waived'] as const)('deposit %s is a no-op, never a repeated resolution', depositReturnStatus => {
    const r = checkout(); r.depositReturnStatus = depositReturnStatus;
    const d = adaptResidentialOpsDecision(identity, 'deposit', wrap({ kind: 'deposit', checkout: r }), now);
    assertForbidden(d, ['record_deposit_resolved']); expect(d.permission.allowedActions).toEqual([]);
  });
  it.each(['status', 'closure', 'execution'] as const)('closed via %s suppresses all lifecycle mutations', source => {
    const r = checkout();
    if (source === 'status') r.status = 'closed';
    if (source === 'closure') r.closureStatus = 'closed';
    if (source === 'execution') r.execution = {
      bookingId: 'B', status: 'closed', closureStatus: 'closed',
    } as NonNullable<InStayCheckoutSnapshot['execution']>;
    for (const kind of ['in_stay', 'checkout', 'deposit', 'closeout'] as const) {
      const value: ResidentialOpsOutput = kind === 'closeout'
        ? { kind, checkout: r, prerequisites: [] } : { kind, checkout: r };
      const d = adaptResidentialOpsDecision(identity, kind, wrap(value), now);
      assertForbidden(d, ['prepare_operator_draft', 'confirm_checkout', 'record_deposit_resolved', 'close_booking']);
      expect(d.permission.allowedActions).toEqual([]);
    }
  });
  it.each(['incident', 'deposit'] as const)('closed plus unresolved %s fails closed across all topics', contradiction => {
    const r = checkout(); r.status = 'closed'; r.closureStatus = 'closed';
    if (contradiction === 'incident') {
      r.openIssues = [{ bookingId: 'B', updatedAt: at, status: 'open' } as GuestStayIssueRow]; r.openIssuesCount = 1;
    } else r.depositReturnStatus = 'ready';
    for (const kind of ['in_stay', 'checkout', 'deposit', 'closeout'] as const) {
      const value: ResidentialOpsOutput = kind === 'closeout'
        ? { kind, checkout: r, prerequisites: [] } : { kind, checkout: r };
      const d = adaptResidentialOpsDecision(identity, kind, wrap(value), now);
      assertForbidden(d, ['prepare_operator_draft', 'confirm_checkout', 'record_deposit_resolved', 'close_booking']);
      expect(d.status).not.toBe('allowed');
      expect([...d.blockers, ...d.manualControls]).toContain(contradiction === 'incident' ? 'open_incident' : 'deposit_unresolved');
    }
  });
  it.each(['not_checked_in', 'in_stay', 'checkout_pending'] as const)(
    'empty close prerequisites cannot authorize closeout at %s', status => {
      const r = checkout(); r.status = status; r.closureStatus = 'open';
      const d = adaptResidentialOpsDecision(identity, 'closeout', wrap({ kind: 'closeout', checkout: r, prerequisites: [] }), now);
      assertForbidden(d, ['close_booking']); expect(d.status).not.toBe('allowed');
    });
  it('missing close guard still fails closed for an already closed display', () => {
    const r = checkout(); r.status = 'closed';
    const value = { kind: 'closeout', checkout: r } as ResidentialOpsOutput;
    const d = adaptResidentialOpsDecision(identity, 'closeout', wrap(value), now);
    assertForbidden(d, ['close_booking']); expect(d.status).toBe('unavailable');
  });
});
