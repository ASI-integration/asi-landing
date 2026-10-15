/** Additive, internal advisory contract. No authority, entitlement or provider side effects. */
import type { LocationAnalysis } from '../location/types';
import type { RetailPremisesAttributes } from '../location/street-retail-suitability';
export type EvidenceKind = 'observed' | 'declared' | 'modelled' | 'course_heuristic' | 'synthetic';
export interface Evidence {
    id: string;
    kind: EvidenceKind;
    locator: string;
    observedAt: string;
    expiresAt: string;
    rights: string;
    digest: string;
}
export type Fact<T> = {
    value: T;
    evidenceIds: string[];
} | {
    value: null;
    reason: string;
    evidenceIds: [
    ];
};
export interface SharedProperty {
    accountId: string;
    propertyId: string;
    revision: string;
    canonicalAddress: string;
    geographyRevision: string;
    identity: 'resolved' | 'ambiguous' | 'unverified';
    evidence: Evidence[];
    /** Existing analysis is model context only, never measured traffic or legal evidence. */
    locationAnalysis?: LocationAnalysis;
    premises: RetailPremisesAttributes;
    measuredFootfallPerHour: Fact<number>;
    permittedUses: Fact<string[]>;
    totalPowerKw: Fact<number>;
}
export interface ScenarioContext {
    accountId: string;
    propertyId: string;
    revision: string;
    asOf: string;
}
export function finite(n: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): void {
    if (!Number.isFinite(n) || n < min || n > max)
        throw new Error(`Invalid ${name}`);
}
export function validateProperty(p: SharedProperty, c: ScenarioContext): string[] {
    if (!c.accountId || !c.propertyId || !c.revision || p.accountId !== c.accountId || p.propertyId !== c.propertyId || p.revision !== c.revision)
        throw new Error('Property scope/revision mismatch');
    if (!p.geographyRevision || !p.canonicalAddress)
        throw new Error('Missing shared geography identity');
    const now = Date.parse(c.asOf);
    if (!Number.isFinite(now))
        throw new Error('Invalid asOf');
    const ids = new Map<string, Evidence>();
    for (const e of p.evidence) {
        if (!e.id || ids.has(e.id) || !e.locator || !e.rights || !/^[a-f0-9]{64}$/.test(e.digest))
            throw new Error('Invalid evidence identity/provenance');
        if (!['observed', 'declared', 'modelled', 'course_heuristic', 'synthetic'].includes(e.kind))
            throw new Error('Invalid evidence kind');
        const observed = Date.parse(e.observedAt), expiry = Date.parse(e.expiresAt);
        if (!Number.isFinite(observed) || !Number.isFinite(expiry) || observed > now || expiry < observed)
            throw new Error('Invalid evidence dates');
        ids.set(e.id, e);
    }
    const holds = new Set<string>(['ADVISORY_ONLY', 'ENGINEERING_AND_LEGAL_SIGNOFF_NOT_ESTABLISHED']);
    if (p.identity !== 'resolved')
        holds.add('UNRESOLVED_PROPERTY');
    for (const [name, fact] of Object.entries({ footfall: p.measuredFootfallPerHour, permittedUses: p.permittedUses, power: p.totalPowerKw })) {
        if (fact.value === null) {
            holds.add(`UNKNOWN_${name}`);
            continue;
        }
        if (!fact.evidenceIds.length || fact.evidenceIds.some(id => !ids.has(id)))
            throw new Error('Unbound property fact');
        for (const id of fact.evidenceIds) {
            const e = ids.get(id)!;
            if (Date.parse(e.expiresAt) < now)
                holds.add(`STALE_${name}`);
            if (e.kind !== 'observed')
                holds.add(`UNVERIFIED_${name}`);
            if (name === 'footfall' && e.kind !== 'observed')
                throw new Error('Proxy cannot be measured footfall');
        }
    }
    if (p.measuredFootfallPerHour.value !== null)
        finite(p.measuredFootfallPerHour.value, 'footfall');
    if (p.totalPowerKw.value !== null)
        finite(p.totalPowerKw.value, 'power');
    return [...holds];
}
