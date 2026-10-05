import { REASONS, freezeDeep, isFresh, sameIdentity, validIdentity, type DecisionIdentity, type DecisionReason } from './decision';
import { readCommunicationDependency } from '../communication/knowledge-provenance';

export type IdentifiedScope = Extract<DecisionIdentity, { kind: 'identified' }>;
export type ScopedSnapshot<T> =
  | Readonly<{ available: true; identity: IdentifiedScope; observedAt: string; value: T }>
  | Readonly<{ available: false; reason: DecisionReason }>;
export type CanonicalVersion = Readonly<{ identity: IdentifiedScope; revision: string; observedAt: string }>;
/**
 * Optional server-side read seam. Both dependencies MUST be read-only.
 * revision must cover ownership AND all readiness/deposit/incident inputs.
 * No DB clients, persistence or executors are imported here.
 */
export async function readStableSnapshot<T>(identity: IdentifiedScope, deps: {
  readVersion: (identity: IdentifiedScope) => Promise<CanonicalVersion | null>;
  load: (identity: IdentifiedScope) => Promise<T>;
  now: () => number;
  maxAgeMs?: number;
}): Promise<ScopedSnapshot<T>> {
  if (!validIdentity(identity) || identity.kind !== 'identified') return { available: false, reason: 'scope_mismatch' };
  const scope = freezeDeep({ ...identity });
  try {
    const first = await readCommunicationDependency(() => deps.readVersion(scope));
    if (!first || !sameIdentity(scope, first.identity)) return { available: false, reason: 'scope_mismatch' };
    const before = structuredClone(first);
    if (typeof before.revision !== 'string' || !before.revision.trim()) return { available: false, reason: 'malformed' };
    if (!isFresh(before.observedAt, deps.now(), deps.maxAgeMs)) return { available: false, reason: 'stale' };
    const value = freezeDeep(structuredClone(await readCommunicationDependency(() => deps.load(scope))));
    const after = await readCommunicationDependency(() => deps.readVersion(scope));
    if (!after || !sameIdentity(scope, after.identity) || before.revision !== after.revision
      || before.observedAt !== after.observedAt) return { available: false, reason: 'state_changed' };
    if (!isFresh(before.observedAt, deps.now(), deps.maxAgeMs)) return { available: false, reason: 'stale' };
    return freezeDeep({ available: true, identity: scope, observedAt: before.observedAt, value });
  } catch {
    return { available: false, reason: 'unavailable' };
  }
}
export function snapshotProblem<T>(
  identity: IdentifiedScope,
  snapshot: ScopedSnapshot<T>,
  now: number,
  maxAgeMs?: number,
): DecisionReason | null {
  if (!validIdentity(identity) || identity.kind !== 'identified') return 'scope_mismatch';
  if (!snapshot || typeof snapshot !== 'object') return 'malformed';
  if (snapshot.available === false) return Object.hasOwn(REASONS, snapshot.reason) ? snapshot.reason : 'malformed';
  if (snapshot.available !== true) return 'malformed';
  if (!sameIdentity(identity, snapshot.identity)) return 'scope_mismatch';
  return isFresh(snapshot.observedAt, now, maxAgeMs) ? null : 'stale';
}
