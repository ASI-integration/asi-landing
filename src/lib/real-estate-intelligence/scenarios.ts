import { buildCommercialFormatFit } from '../location/commercial-format-fit';
import { evaluateStreetRetailSuitability } from '../location/street-retail-suitability';
import { finite, validateProperty, type SharedProperty, type ScenarioContext } from './contracts';
import { ledger, validateEconomics, type Economics } from './cashflow';
import { enumerateLayouts, type FloorPlan, type UnitCandidate } from './layouts';
export interface TenantCategory {
    id: string;
    permittedUse: string;
    minArea: number;
    maxArea: number;
    minFrontage: number;
    minWindows: number;
    powerKw: number;
    needsWater: boolean;
    needsExhaust: boolean;
    rentPerM2: number;
    vacancyShare: number;
    collectionRate: number;
    annualRentEscalation: number;
    fitoutMonths: number;
    maxInstances: number;
    estimatedMonthlySales: number | null;
    maxRentToSalesShare: number | null;
    evidenceIds: string[];
}
function bound(p: SharedProperty, ids: string[]) { if (!ids.length || ids.some(id => !p.evidence.some(e => e.id === id)))
    throw new Error('Missing scenario evidence'); }
function base(p: SharedProperty, c: ScenarioContext, e: Economics) {
    const holds = validateProperty(p, c);
    validateEconomics(e);
    bound(p, e.assumptionEvidenceIds);
    if (e.revenueTaxShare === null)
        holds.push('TAX_UNKNOWN');
    if (p.evidence.some(x => Date.parse(x.expiresAt) < Date.parse(c.asOf)))
        holds.push('STALE_SCENARIO_EVIDENCE');
    return { propertyId: p.propertyId, revision: p.revision, geographyRevision: p.geographyRevision, holds, automaticActionAllowed: false as const, investmentReady: false as const };
}
export function residentialScenario(p: SharedProperty, c: ScenarioContext, e: Economics, input: {
    kind: 'long_term_rental' | 'residential_purchase';
    monthlyRent: number;
    vacancyShare: number;
    annualEscalation: number;
    evidenceIds: string[];
} | {
    kind: 'short_term_rental';
    months: {
        availableNights: number;
        occupancy: number;
        adr: number;
    }[];
    evidenceIds: string[];
}) {
    const shared = base(p, c, e);
    bound(p, input.evidenceIds);
    const allowed = p.permittedUses.value;
    if (allowed !== null && !allowed.includes('residential'))
        return { ...shared, kind: input.kind, status: 'REJECTED_USE' as const, economics: null };
    let income: number[];
    if (input.kind === 'short_term_rental') {
        if (input.months.length !== e.months)
            throw new Error('STR horizon mismatch');
        income = input.months.map(m => { finite(m.availableNights, 'nights', 0, 31); finite(m.occupancy, 'occupancy', 0, 1); finite(m.adr, 'ADR', 0, 1e7); return m.availableNights * m.occupancy * m.adr; });
    }
    else {
        finite(input.monthlyRent, 'monthly rent', 0, 1e10);
        finite(input.vacancyShare, 'vacancy', 0, 1);
        finite(input.annualEscalation, 'escalation', 0, 1);
        income = Array.from({ length: e.months }, (_, i) => input.monthlyRent * (1 - input.vacancyShare) * (1 + input.annualEscalation) ** Math.floor(i / 12));
    }
    return { ...shared, kind: input.kind, status: 'CONDITIONAL_MODEL' as const, economics: ledger(income, e) };
}
export function commercialScenarios(p: SharedProperty, c: ScenarioContext, e: Economics, plan: FloorPlan, tenants: TenantCategory[], assignmentBudget = 10000) {
    const shared = base(p, c, e);
    bound(p, plan.evidenceIds);
    if (p.premises.floorClass !== 'street_eligible')
        shared.holds.push('STREET_RETAIL_PREMISES_NOT_CONFIRMED');
    if (plan.propertyId !== p.propertyId)
        throw new Error('Plan property mismatch');
    if (!Number.isInteger(assignmentBudget) || assignmentBudget < 1 || assignmentBudget > 50000)
        throw new Error('Invalid search budget');
    if (!tenants.length || tenants.length > 8 || new Set(tenants.map(t => t.id)).size !== tenants.length)
        throw new Error('Invalid tenant catalogue');
    for (const t of tenants) {
        if (typeof t.needsWater !== 'boolean' || typeof t.needsExhaust !== 'boolean')
            throw new Error('Invalid tenant utilities');
        bound(p, t.evidenceIds);
        if (!t.id || !t.permittedUse)
            throw new Error('Invalid tenant identity');
        for (const k of ['minArea', 'maxArea', 'minFrontage', 'minWindows', 'powerKw', 'rentPerM2'] as const)
            finite(t[k], k, 0, 1e6);
        if (t.minArea > t.maxArea)
            throw new Error('Invalid area interval');
        for (const k of ['vacancyShare', 'collectionRate', 'annualRentEscalation'] as const)
            finite(t[k], k, 0, 1);
        if (!Number.isInteger(t.fitoutMonths) || t.fitoutMonths < 0 || t.fitoutMonths > e.months || !Number.isInteger(t.maxInstances) || t.maxInstances < 1 || t.maxInstances > 8)
            throw new Error('Invalid tenant timing/count');
        if (t.estimatedMonthlySales !== null)
            finite(t.estimatedMonthlySales, 'tenant sales', 0, 1e10);
        if (t.maxRentToSalesShare !== null)
            finite(t.maxRentToSalesShare, 'rent affordability', 0, 1);
    }
    const layout = enumerateLayouts(plan);
    const results: {
        units: UnitCandidate[];
        tenantIds: string[];
        powerKw: number;
        modelledMonthlyGrossRent: number;
        economics: ReturnType<typeof ledger>;
        conditionalReasons: string[];
    }[] = [];
    type Candidate = (typeof results)[number];
    const compare = (a: Candidate, b: Candidate) => b.economics.npv - a.economics.npv || a.tenantIds.join('|').localeCompare(b.tenantIds.join('|'));
    const best: {
        whole: Candidate | null;
        split: Candidate | null;
    } = { whole: null, split: null };
    function retain(candidate: Candidate) {
        if (candidate.units.length === 1) {
            if (!best.whole || compare(candidate, best.whole) < 0)
                best.whole = candidate;
        }
        else if (!best.split || compare(candidate, best.split) < 0)
            best.split = candidate;
        results.push(candidate);
        results.sort(compare);
        if (results.length > 25)
            results.pop();
    }
    let searchNodesVisited = 0, truncated = false;
    const fits = (u: UnitCandidate, t: TenantCategory) => u.area >= t.minArea && u.area <= t.maxArea && u.frontageMetres >= t.minFrontage && u.windowMetres >= t.minWindows && (!t.needsWater || u.water !== false) && (!t.needsExhaust || u.independentExhaust !== false) && (p.permittedUses.value === null || p.permittedUses.value.includes(t.permittedUse)) && (t.estimatedMonthlySales === null || t.maxRentToSalesShare === null || u.area * t.rentPerM2 <= t.estimatedMonthlySales * t.maxRentToSalesShare);
    for (const units of layout.layouts) {
        const assigned: TenantCategory[] = [];
        function search(i: number) {
            if (searchNodesVisited >= assignmentBudget) {
                truncated = true;
                return;
            }
            searchNodesVisited++;
            if (i === units.length) {
                const powerKw = assigned.reduce((s, t) => s + t.powerKw, 0);
                if (p.totalPowerKw.value !== null && powerKw > p.totalPowerKw.value)
                    return;
                const income = Array.from({ length: e.months }, (_, m) => units.reduce((s, u, j) => { const t = assigned[j]; return s + (m < t.fitoutMonths ? 0 : u.area * t.rentPerM2 * (1 - t.vacancyShare) * t.collectionRate * (1 + t.annualRentEscalation) ** Math.floor(m / 12)); }, 0));
                const reasons: string[] = [];
                assigned.forEach((t, j) => { if (t.needsWater && units[j].water === null)
                    reasons.push('WATER_UNKNOWN'); if (t.needsExhaust && units[j].independentExhaust === null)
                    reasons.push('EXHAUST_UNKNOWN'); if (t.estimatedMonthlySales === null || t.maxRentToSalesShare === null)
                    reasons.push('TENANT_AFFORDABILITY_UNKNOWN'); });
                retain({ units, tenantIds: assigned.map(t => t.id), powerKw, modelledMonthlyGrossRent: units.reduce((s, u, j) => s + u.area * assigned[j].rentPerM2, 0), economics: ledger(income, { ...e, capex: e.capex + (units.length - 1) * plan.fitoutCostPerAdditionalUnit, monthlyFixedCost: e.monthlyFixedCost + (units.length - 1) * plan.monthlyCostPerAdditionalUnit }), conditionalReasons: [...new Set(reasons)] });
                return;
            }
            for (const t of tenants) {
                if (fits(units[i], t) && assigned.filter(a => a.id === t.id).length < t.maxInstances) {
                    assigned.push(t);
                    search(i + 1);
                    assigned.pop();
                }
                if (truncated)
                    return;
            }
        }
        search(0);
        if (truncated)
            break;
    }
    // Existing area/premises gates remain advisory context, never overridden by model cash flow.
    const objectContext = { ...p.premises, floorLevel: ({ street_eligible: 'street-level', below_street: 'basement', upper_or_interior: 'upper floor', unknown: '' } as const)[p.premises.floorClass] };
    const existingFit = p.locationAnalysis ? buildCommercialFormatFit(p.locationAnalysis, { objectContext }) : null;
    const premisesGate = p.locationAnalysis ? evaluateStreetRetailSuitability(p.locationAnalysis, objectContext) : null;
    return { ...shared, kind: 'commercial_whole_vs_split' as const, existingFit, premisesGate, search: { partitionsConsidered: layout.partitionsConsidered, layoutsConsidered: layout.layouts.length, searchNodesVisited, truncated, optimality: truncated ? 'BEST_EXPLORED_ONLY' : 'BEST_WITHIN_SUPPLIED_CELL_AND_TENANT_SET' }, commonArea: layout.commonArea, lettableArea: layout.lettableArea, topCandidates: results, bestWhole: best.whole, bestSplit: best.split, missingCandidateMeaning: truncated ? 'NOT_ESTABLISHED_SEARCH_INCOMPLETE' : 'NO_MATCH_WITHIN_SUPPLIED_CONSTRAINTS' };
}
/** Missing meter data is not zero consumption; rollover needs a separately evidenced policy. */
export function meterCharge(previous: number | null, current: number | null, unitPrice: number): number | null {
    finite(unitPrice, 'tariff');
    if (previous === null || current === null)
        return null;
    finite(previous, 'previous reading');
    finite(current, 'current reading');
    if (current < previous)
        throw new Error('Negative consumption requires review');
    return Math.round((current - previous) * unitPrice * 100) / 100;
}
export function sampledFootfall(count: number, minutes: number) { finite(count, 'count'); finite(minutes, 'minutes', 0.01, 1440); return { observedCount: count, sampleMinutes: minutes, extrapolatedHourlyRate: count * 60 / minutes, fullDayRate: null, kind: 'sample_extrapolation' as const }; }
