import { describe, it, expect } from 'vitest';
import { planHistoricalAccessReview, type HistoricalGrantEvidence } from '../historical-access-reconciliation';
function evidence(): HistoricalGrantEvidence {
  return { entitlementId: 'synthetic-1', status: 'active', accessLevel: 'full_report', requestId: 'r', reportId: 'p', snapshotId: 's',
    request: { id: 'r', accessTier: 'paid_required', paymentStatus: 'paid_unlocked' },
    report: { id: 'p', requestId: 'r', snapshotId: 's' }, snapshot: { id: 's', requestId: 'r' },
    reviewedAuthorization: { requestId: 'r', evidenceDigest: 'a'.repeat(64), kind: 'payment' } };
}
describe('Offline historical entitlement review', () => {
  it('does not revoke a documented legitimate grant or expose raw identifiers', () => {
    const result = planHistoricalAccessReview([evidence()]);
    expect(result.items[0].disposition).toBe('NO_FINDING_IN_SUPPLIED_EVIDENCE');
    expect(result.writes).toBe(0);
    expect(JSON.stringify(result)).not.toContain('synthetic-1');
  });
  it.each(['included', null, 'unrecognized'])('holds legacy tier %s for review, not automatic revocation', tier => {
    const row = evidence(); row.request!.accessTier = tier;
    expect(planHistoricalAccessReview([row]).items[0].reasons).toContain('legacy_or_unknown_access_tier');
  });
  it('unlocked status is not proof of authorization', () => {
    const row = evidence(); row.reviewedAuthorization = null;
    expect(planHistoricalAccessReview([row]).items[0].reasons).toContain('independently_reviewed_authorization_missing');
  });
  it('detects cross-request report and snapshot bindings', () => {
    const row = evidence(); row.report!.requestId = 'other'; row.snapshot!.requestId = 'other';
    expect(planHistoricalAccessReview([row]).items[0].reasons).toHaveLength(2);
  });
  it('rejects duplicate identities instead of losing contradictory evidence', () => {
    expect(() => planHistoricalAccessReview([evidence(), evidence()])).toThrow('duplicate');
  });
  it('preserves free preview without pretending it proves payment', () => {
    const row = evidence(); row.accessLevel = 'preview'; row.reviewedAuthorization = null;
    expect(planHistoricalAccessReview([row]).items[0].reasons).toEqual([]);
  });
  it('binds the manifest to reviewed evidence even when findings do not change', () => {
    const a = evidence(), b = evidence(); b.reviewedAuthorization!.evidenceDigest = 'b'.repeat(64);
    const left = planHistoricalAccessReview([a]), right = planHistoricalAccessReview([b]);
    expect(left.items).toEqual(right.items);
    expect(left.manifestSha256).not.toBe(right.manifestSha256);
  });
  it('is deterministic and does not mutate its inputs', () => {
    const a = evidence(), b = { ...evidence(), entitlementId: 'synthetic-2' };
    const before = JSON.stringify([a,b]);
    expect(planHistoricalAccessReview([a,b]).manifestSha256).toBe(planHistoricalAccessReview([b,a]).manifestSha256);
    expect(JSON.stringify([a,b])).toBe(before);
  });
});
