/** Offline review only. Never authorizes access or writes to a database. */
import { createHash } from 'node:crypto';
export interface HistoricalGrantEvidence {
  entitlementId: string;
  status: string | null;
  accessLevel: string;
  requestId: string;
  reportId: string | null;
  snapshotId: string;
  request: null | { id: string; accessTier: string | null; paymentStatus: string | null };
  report: null | { id: string; requestId: string; snapshotId: string };
  snapshot: null | { id: string; requestId: string };
  /** Supplied by an independently reviewed export, never inferred from unlocked status. */
  reviewedAuthorization: null | { requestId: string; evidenceDigest: string; kind: 'payment' | 'manual' };
}
export function planHistoricalAccessReview(rows: readonly HistoricalGrantEvidence[]) {
  // Canonical JSON binds the exact evidence as well as the findings. No raw
  // evidence is returned, and a digest is not verification of its authenticity.
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}';
  };
  const evidenceSha256 = createHash('sha256').update(canonical([...rows].sort((a,b) => a.entitlementId.localeCompare(b.entitlementId)))).digest('hex');
  const seen = new Set<string>();
  const items = rows.map(row => {
    if (!row.entitlementId || seen.has(row.entitlementId)) throw new Error('Missing or duplicate entitlement identity');
    seen.add(row.entitlementId);
    const reasons: string[] = [];
    const inactive = row.status === 'revoked' || row.status === 'expired';
    if (!inactive && row.status !== 'active') reasons.push('unknown_status');
    if (!inactive && row.accessLevel !== 'preview') {
      if (!row.request || row.request.id !== row.requestId) reasons.push('request_binding_missing_or_conflicting');
      if (!row.snapshot || row.snapshot.id !== row.snapshotId || row.snapshot.requestId !== row.requestId) reasons.push('snapshot_binding_missing_or_conflicting');
      if (!row.report || row.report.id !== row.reportId || row.report.requestId !== row.requestId || row.report.snapshotId !== row.snapshotId) reasons.push('report_binding_missing_or_conflicting');
      if (!['full_report', 'pdf_download', 'admin'].includes(row.accessLevel)) reasons.push('unknown_access_level');
      if (row.request?.accessTier !== 'paid_required') reasons.push('legacy_or_unknown_access_tier');
      if (row.request?.paymentStatus !== 'paid_unlocked') reasons.push('payment_state_not_confirmed');
      const proof = row.reviewedAuthorization;
      if (!proof || proof.requestId !== row.requestId || !/^[a-f0-9]{64}$/i.test(proof.evidenceDigest) || !['payment', 'manual'].includes(proof.kind)) {
        reasons.push('independently_reviewed_authorization_missing');
      }
    }
    return {
      entitlementDigest: createHash('sha256').update(row.entitlementId).digest('hex'),
      disposition: inactive ? 'NO_ACTIVE_GRANT' : reasons.length ? 'HOLD_FOR_OWNER_REVIEW' : 'NO_FINDING_IN_SUPPLIED_EVIDENCE',
      reasons,
    };
  }).sort((a, b) => a.entitlementDigest.localeCompare(b.entitlementDigest));
  return { schemaVersion: 1, dryRun: true, writes: 0, evidenceSha256, items,
    manifestSha256: createHash('sha256').update(JSON.stringify({ evidenceSha256, items })).digest('hex') };
}
